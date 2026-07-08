import type { SoundCue } from "./soundCues";

const SOUND_MUTED_STORAGE_KEY = "block-drop-sound-muted";

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
  private musicGain: GainNode | null = null;
  private musicActive = false;
  private musicStep = 0;
  private musicTimer = 0;
  private muted = readStoredMuted();
  private lastPlayed = new Map<SoundCue, number>();

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    storeMuted(this.muted);

    if (this.muted) {
      this.stopMusicLoop();
    } else if (this.musicActive) {
      void this.unlock().then(() => this.startMusicLoop());
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

  private ensureMusicGain(): GainNode {
    const context = this.ensureContext();

    if (this.musicGain) {
      return this.musicGain;
    }

    const gain = context.createGain();

    gain.gain.value = 0;
    gain.connect(this.master ?? context.destination);
    this.musicGain = gain;
    return gain;
  }

  private setMusicActive(active: boolean): void {
    this.musicActive = active;

    if (!active || this.muted) {
      this.stopMusicLoop();
      return;
    }

    void this.unlock().then(() => {
      if (this.musicActive && !this.muted) {
        this.startMusicLoop();
      }
    });
  }

  private startMusicLoop(): void {
    if (this.musicTimer || this.muted || !this.musicActive) {
      return;
    }

    this.fadeMusic(0.07, 0.34);
    this.scheduleMusicPattern();
  }

  private stopMusicLoop(): void {
    window.clearTimeout(this.musicTimer);
    this.musicTimer = 0;
    this.fadeMusic(0, 0.16);
  }

  private scheduleMusicPattern(): void {
    if (this.muted || !this.musicActive) {
      this.musicTimer = 0;
      return;
    }

    const context = this.ensureContext();
    const stepDuration = 0.185;
    const start = context.currentTime + 0.035;
    const melody = [392, 0, 523.25, 0, 493.88, 0, 329.63, 0, 392, 0, 587.33, 0, 523.25, 493.88, 0, 329.63];
    const bass = [98, 0, 0, 0, 130.81, 0, 0, 0, 110, 0, 0, 0, 146.83, 0, 0, 0];

    for (let index = 0; index < melody.length; index += 1) {
      const step = (this.musicStep + index) % melody.length;
      const when = start + index * stepDuration;
      const melodyFrequency = melody[step];
      const bassFrequency = bass[step];

      if (melodyFrequency > 0) {
        this.musicTone(melodyFrequency, 0.11, when, 0.032, "triangle");
      }

      if (bassFrequency > 0) {
        this.musicTone(bassFrequency, 0.16, when, 0.03, "sine");
      }

      if (step % 4 === 0) {
        this.musicTone(196, 0.045, when, 0.012, "square");
      }
    }

    this.musicStep = (this.musicStep + melody.length) % melody.length;
    this.musicTimer = window.setTimeout(() => {
      this.musicTimer = 0;
      this.scheduleMusicPattern();
    }, melody.length * stepDuration * 1000 - 80);
  }

  private musicTone(
    frequency: number,
    duration: number,
    start: number,
    volume: number,
    type: OscillatorType
  ): void {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const end = start + duration;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.996, end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(this.ensureMusicGain());
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  private fadeMusic(volume: number, duration: number): void {
    const context = this.ensureContext();
    const gain = this.ensureMusicGain();
    const now = context.currentTime;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(volume, now + duration);
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
