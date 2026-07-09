import type { SoundCue } from "./soundCues";

const AUDIO_SETTINGS_STORAGE_KEY = "block-drop-audio-settings";
const AUDIO_SETTINGS_MIX_VERSION = 2;
const SOUND_MUTED_STORAGE_KEY = "block-drop-sound-muted";
const MUSIC_URL = "/audio/block-drop-jingle.mp3";
const BASE_SFX_GAIN = 0.58;

export type AudioSettings = {
  musicEnabled: boolean;
  musicVolume: number;
  sfxEnabled: boolean;
  sfxVolume: number;
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicEnabled: true,
  musicVolume: 0.22,
  sfxEnabled: true,
  sfxVolume: 1
};

type StoredAudioSettings = Partial<AudioSettings> & {
  mixVersion?: number;
};

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
  private compressor: DynamicsCompressorNode | null = null;
  private musicElement: HTMLAudioElement | null = null;
  private musicActive = false;
  private settings = readStoredAudioSettings();
  private muted = readStoredMuted();
  private lastPlayed = new Map<SoundCue, number>();

  get isMuted(): boolean {
    return this.muted;
  }

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  updateSettings(settings: Partial<AudioSettings>): AudioSettings {
    this.settings = normalizeAudioSettings({ ...this.settings, ...settings });
    storeAudioSettings(this.settings);
    this.applySfxVolume();
    this.applyMusicVolume();

    if (!this.settings.musicEnabled || this.settings.musicVolume <= 0) {
      this.stopMusic();
    } else if (this.musicActive && !this.muted) {
      void this.startMusic();
    }

    return this.getSettings();
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    storeMuted(this.muted);
    this.applySfxVolume();

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

    if (this.muted || !this.settings.sfxEnabled || this.settings.sfxVolume <= 0 || this.isThrottled(cue)) {
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
        this.tone(124, 0.12, { endFrequency: 52, type: "sawtooth", volume: 0.18 });
        this.noise(0.105, { delay: 0.018, filter: 780, volume: 0.14 });
        break;
      case "lock":
        this.tone(154, 0.07, { endFrequency: 92, type: "square", volume: 0.13 });
        this.noise(0.065, { filter: 620, volume: 0.09 });
        break;
      case "line-clear":
        this.tone(430, 0.075, { type: "triangle", volume: 0.135 });
        this.tone(570, 0.075, { delay: 0.055, type: "triangle", volume: 0.14 });
        this.tone(780, 0.095, { delay: 0.118, type: "triangle", volume: 0.155 });
        break;
      case "quad-clear":
        this.tone(360, 0.095, { type: "triangle", volume: 0.135 });
        this.tone(540, 0.095, { delay: 0.06, type: "triangle", volume: 0.145 });
        this.tone(760, 0.11, { delay: 0.125, type: "triangle", volume: 0.17 });
        this.tone(1120, 0.22, { delay: 0.205, type: "square", volume: 0.145 });
        this.noise(0.3, { delay: 0.105, filter: 3400, volume: 0.12 * intensity });
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
    if (this.context && this.master && this.compressor) {
      return this.context;
    }

    const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextConstructor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    const context = new AudioContextConstructor();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();

    master.gain.value = this.getSfxGain();
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(context.destination);
    this.context = context;
    this.master = master;
    this.compressor = compressor;
    return context;
  }

  private setMusicActive(active: boolean): void {
    this.musicActive = active;

    if (!active || this.muted || !this.settings.musicEnabled || this.settings.musicVolume <= 0) {
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
    audio.volume = this.getMusicVolume();
    this.musicElement = audio;
    return audio;
  }

  private async startMusic(): Promise<void> {
    if (this.muted || !this.musicActive || !this.settings.musicEnabled || this.settings.musicVolume <= 0) {
      return;
    }

    const audio = this.ensureMusicElement();

    audio.volume = this.getMusicVolume();

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

  private applyMusicVolume(): void {
    if (this.musicElement) {
      this.musicElement.volume = this.getMusicVolume();
    }
  }

  private applySfxVolume(): void {
    if (this.master) {
      this.master.gain.value = this.getSfxGain();
    }
  }

  private getMusicVolume(): number {
    return this.muted || !this.settings.musicEnabled ? 0 : this.settings.musicVolume;
  }

  private getSfxGain(): number {
    return this.muted || !this.settings.sfxEnabled ? 0 : BASE_SFX_GAIN * this.settings.sfxVolume;
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

function readStoredAudioSettings(): AudioSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY) ?? "null") as StoredAudioSettings | null;
    const settings = normalizeAudioSettings(stored);

    if (stored && typeof stored === "object" && stored.mixVersion !== AUDIO_SETTINGS_MIX_VERSION) {
      settings.musicVolume = Math.min(settings.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume);
      storeAudioSettings(settings);
    }

    return settings;
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function storeAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, mixVersion: AUDIO_SETTINGS_MIX_VERSION }));
  } catch {
    // Audio preferences are optional; gameplay should continue if storage is unavailable.
  }
}

function normalizeAudioSettings(value: unknown): AudioSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }

  const candidate = value as Partial<AudioSettings>;

  return {
    musicEnabled: typeof candidate.musicEnabled === "boolean" ? candidate.musicEnabled : DEFAULT_AUDIO_SETTINGS.musicEnabled,
    musicVolume: clamp01(candidate.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
    sfxEnabled: typeof candidate.sfxEnabled === "boolean" ? candidate.sfxEnabled : DEFAULT_AUDIO_SETTINGS.sfxEnabled,
    sfxVolume: clamp01(candidate.sfxVolume, DEFAULT_AUDIO_SETTINGS.sfxVolume)
  };
}

function clamp01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}
