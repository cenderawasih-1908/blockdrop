export type GameAction =
  | "move-left"
  | "move-right"
  | "soft-drop"
  | "hard-drop"
  | "rotate-cw"
  | "rotate-ccw"
  | "pause"
  | "restart";

export type KeyBindings = Record<GameAction, string[]>;

export const GAME_ACTIONS: readonly GameAction[] = [
  "move-left",
  "move-right",
  "rotate-cw",
  "rotate-ccw",
  "soft-drop",
  "hard-drop",
  "pause",
  "restart"
];

export const ACTION_LABELS: Readonly<Record<GameAction, string>> = {
  "move-left": "Move left",
  "move-right": "Move right",
  "soft-drop": "Soft drop",
  "hard-drop": "Hard drop",
  "rotate-cw": "Rotate",
  "rotate-ccw": "Rotate back",
  pause: "Pause",
  restart: "Restart"
};

export const BINDINGS_STORAGE_KEY = "block-drop-key-bindings";

export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = {
  "move-left": ["ArrowLeft", "KeyA"],
  "move-right": ["ArrowRight", "KeyD"],
  "soft-drop": ["ArrowDown", "KeyS"],
  "hard-drop": ["Space"],
  "rotate-cw": ["ArrowUp", "KeyW", "KeyX"],
  "rotate-ccw": ["KeyZ"],
  pause: ["KeyP", "Escape"],
  restart: ["KeyR"]
};

declare global {
  interface Window {
    blockDropKeyBindings?: KeyBindings;
  }
}

export const NON_REPEAT_ACTIONS = new Set<GameAction>([
  "hard-drop",
  "rotate-cw",
  "rotate-ccw",
  "pause",
  "restart"
]);

export function createDefaultKeyBindings(): KeyBindings {
  return Object.fromEntries(
    GAME_ACTIONS.map((action) => [action, [...DEFAULT_KEY_BINDINGS[action]]])
  ) as KeyBindings;
}

export function keyBindingsToActionMap(bindings: KeyBindings): Record<string, GameAction> {
  const keyToAction: Record<string, GameAction> = {};

  for (const action of GAME_ACTIONS) {
    for (const code of bindings[action]) {
      keyToAction[code] = action;
    }
  }

  return keyToAction;
}

export function normalizeKeyBindings(value: unknown): KeyBindings {
  const defaults = createDefaultKeyBindings();

  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<Record<GameAction, unknown>>;

  for (const action of GAME_ACTIONS) {
    const codes = candidate[action];

    if (Array.isArray(codes)) {
      const validCodes = codes.filter((code): code is string => typeof code === "string" && code.length > 0);

      if (validCodes.length > 0) {
        defaults[action] = [...new Set(validCodes)];
      }
    }
  }

  return defaults;
}

export function formatKeyLabel(code: string): string {
  if (code.startsWith("Key")) {
    return code.slice(3);
  }

  if (code.startsWith("Digit")) {
    return code.slice(5);
  }

  const labels: Readonly<Record<string, string>> = {
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowDown: "Down",
    ArrowUp: "Up",
    Space: "Space",
    Escape: "Esc",
    Backspace: "Backspace",
    Enter: "Enter",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt"
  };

  return labels[code] ?? code.replace(/([a-z])([A-Z])/g, "$1 $2");
}
