export const SOUND_CUE_EVENT = "blockdrop:sound";

export type SoundCue =
  | "move"
  | "rotate"
  | "soft-drop"
  | "hard-drop"
  | "lock"
  | "line-clear"
  | "quad-clear"
  | "pause"
  | "resume"
  | "start"
  | "restart"
  | "game-over"
  | "menu"
  | "select"
  | "toggle-sound";

export type SoundCueDetail = {
  cue: SoundCue;
  intensity?: number;
};

export function emitSoundCue(cue: SoundCue, detail: Omit<SoundCueDetail, "cue"> = {}): void {
  window.dispatchEvent(new CustomEvent<SoundCueDetail>(SOUND_CUE_EVENT, { detail: { cue, ...detail } }));
}
