import type { SoundCue } from "./soundCues";

const SOUND_MUTED_STORAGE_KEY = "block-drop-sound-muted";
const MUSIC_URL = "/audio/block-drop-jingle.mp3";
const MUSIC_VOLUME = 0.72;

type ToneOptions = {
  delay?: number;
  endFrequency?: number;
  type?: OscillatorType;
  volume?: number;
};

type NoiseOptions = {
  delay?: number;
  filter?: number;
  volume?: number;
};

export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicElement: HTMLAudioElement | null = null;
  private musicActive = false;
  private muted = readStoredMuted();
  private lastPlayed = new Map<SoundCue, number>();

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    storeMuted(this.muted);

    if (this.muted) {
      this.stopMusic();
    } else if (this.musicActive) {
      void this.unlock().then(() => void this.startMusic());
    }

    return this.muted;
  }

  async unlock(): Promise<void> {
    if (this.muted) {
      return;
    }

    const context = this.ensureContext();

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        // Some mobile browsers reject resume outside a trusted gesture.
      }
    }

    if (this.musicActive) {
      await this.startMusic();
    }
  }

  play(cue: SoundCue, intensity = 1): void {
    if (cue === "start" || cue === "resume" || cue === "restart") {
      this.setMusicActive(true);
    }

    if (cue === "pause" || cue === "game-over" || cue === "menu") {
      this.setMusicActive(false);
    }

    if (this.muted || this.isThrottled(cue)) {
      return;
    }

    void this.unlock();

    switch (cue) {
      case "move":
        this.tone(190, 0.035, { type: "square", volume: 0.035 });
        break;
      case "rotate":
        this.tone(330, 0.045, { type: "triangle", volume: 0.044 });
        this.tone(520, 0.04, { delay: 0.035, type: "triangle", volume: 0.032 });
        break;
      case "soft-drop":
        this.tone(118, 0.035, { type: "triangle", volume: 0.032 });
        break;
      case "hard-drop":
        this.tone(120, 0.105, { endFrequency: 58, type: "sawtooth", volume: 0.08 });
        this.noise(0.08, { delay: 0.025, filter: 640, volume: 0.06 });
        break;
      case "lock":
        this.tone(150, 0.055, { endFrequency: 105, type: "square", volume: 0.055 });
        this.noise(0.045, { filter: 520, volume: 0.032 });
        break;
      case "line-clear":
        this.tone(430, 0.06, { type: "triangle", volume: 0.052 });
        this.tone(560, 0.06, { delay: 0.055, type: "triangle", volume: 0.052 });
        this.tone(760, 0.075, { delay: 0.115, type: "triangle", volume: 0.058 });
        break;
      case "quad-clear":
        this.tone(360, 0.08, { type: "triangle", volume: 0.058 });
        this.tone(540, 0.08, { delay: 0.06, type: "triangle", volume: 0.058 });
        this.tone(720, 0.09, { delay: 0.12, type: "triangle", volume: 0.064 });
        this.tone(1080, 0.16, { delay: 0.2, type: "square", volume: 0.054 });
        this.noise(0.22, { delay: 0.11, filter: 2800, volume: 0.045 * intensity });
        break;
      case "pause":
        this.tone(420, 0.055, { type: "triangle", volume: 0.04 });
        this.tone(260, 0.075, { delay: 0.06, type: "triangle", volume: 0.04 });
        break;
      case "resume":
      case "start":
        this.tone(260, 0.05, { type: "triangle", volume: 0.046 });
        this.tone(390, 0.055, { delay: 0.055, type: "triangle", volume: 0.046 });
        this.tone(520, 0.07, { delay: 0.115, type: "triangle", volume: 0.05 });
        break;
      case "restart":
        this.tone(250, 0.045, { type: "square", volume: 0.044 });
        this.tone(340, 0.045, { delay: 0.045, type: "square", volume: 0.044 });
        this.tone(450, 0.065, { delay: 0.09, type: "square", volume: 0.048 });
        break;
      case "game-over":
        this.tone(330, 0.12, { type: "sawtooth", volume: 0.048 });
        this.tone(250, 0.14, { delay: 0.12, type: "sawtooth", volume: 0.046 });
        this.tone(165, 0.24, { delay: 0.26, type: "triangle", volume: 0.052 });
        break;
      case "menu":
      case "select":
        this.tone(cue === "menu" ? 260 : 310, 0.045, { type: "square", volume: 0.038 });
        break;
      case "toggle-sound":
        this.tone(500, 0.045, { type: "triangle", volume: 0.046 });
        this.tone(700, 0.06, { delay: 0.055, type: "triangle", volume: 0.044 });
        break;
    }
  }

  private ensureContext(): AudioContext {
    if (this.context && this.master) {
      return this.context;
    }

    const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    const context = new AudioContextConstructor();
    const master = context.createGain();

    master.gain.value = 0.28;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return context;
  }

  private setMusicActive(active: boolean): void {
    this.musicActive = active;

    if (!active || this.muted) {
      this.stopMusic();
      return;
    }

    void this.startMusic();
    void this.unlock();
  }

  private ensureMusicElement(): HTMLAudioElement {
    if (this.musicElement) {
      return this.musicElement;
    }

    const audio = document.createElement("audio");

    audio.src = MUSIC_URL;
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = MUSIC_VOLUME;
    this.musicElement = audio;
    return audio;
  }

  private async startMusic(): Promise<void> {
    if (this.muted || !this.musicActive) {
      return;
    }

    const audio = this.ensureMusicElement();

    audio.volume = MUSIC_VOLUME;

    if (!audio.paused) {
      return;
    }

    try {
      await audio.play();
    } catch {
      // Browsers may still block playback until the next trusted gesture.
    }
  }

  private stopMusic(): void {
    const audio = this.musicElement;

    if (audio) {
      audio.pause();
    }
  }

  private tone(frequency: number, duration: number, options: ToneOptions = {}): void {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + (options.delay ?? 0.004);
    const end = start + duration;
    const volume = options.volume ?? 0.05;

    oscillator.type = options.type ?? "square";
    oscillator.frequency.setValueAtTime(frequency, start);

    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFrequency), end);
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(this.master ?? context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.03);
  }

  private noise(duration: number, options: NoiseOptions = {}): void {
    const context = this.ensureContext();
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index += 1) {
      const fade = 1 - index / frameCount;
      data[index] = (Math.random() * 2 - 1) * fade;
    }

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime + (options.delay ?? 0.004);
    const volume = options.volume ?? 0.04;

    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(options.filter ?? 900, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master ?? context.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private isThrottled(cue: SoundCue): boolean {
    const throttleMs = cue === "move" || cue === "soft-drop" ? 55 : cue === "rotate" ? 42 : 0;

    if (throttleMs === 0) {
      return false;
    }

    const now = window.performance.now();
    const last = this.lastPlayed.get(cue) ?? 0;

    if (now - last < throttleMs) {
      return true;
    }

    this.lastPlayed.set(cue, now);
    return false;
  }
}

function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function storeMuted(muted: boolean): void {
  try {
    localStorage.setItem(SOUND_MUTED_STORAGE_KEY, String(muted));
  } catch {
    // Sound preference is optional; gameplay should continue if storage is unavailable.
  }
}
