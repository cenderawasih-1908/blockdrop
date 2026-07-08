import Phaser from "phaser";
import "./styles.css";
import {
  ACTION_LABELS,
  BINDINGS_STORAGE_KEY,
  createDefaultKeyBindings,
  formatKeyLabel,
  GAME_ACTIONS,
  normalizeKeyBindings,
  type GameAction,
  type KeyBindings
} from "./game/input/actions";
import { SoundEngine } from "./game/audio/soundEngine";
import { SOUND_CUE_EVENT, type SoundCueDetail } from "./game/audio/soundCues";
import { PIECE_META, PIECES, type PieceType } from "./game/simulation/pieces";
import type { GameSnapshot } from "./game/simulation/blockDropGame";
import { PlayScene } from "./phaser/scenes/PlayScene";

let keyBindings = loadKeyBindings();
let pendingBindingAction: GameAction | null = null;

window.blockDropKeyBindings = cloneKeyBindings(keyBindings);

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 360,
  height: 660,
  backgroundColor: "#101216",
  scene: [PlayScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: {
    pixelArt: false,
    antialias: true
  }
};

new Phaser.Game(gameConfig);

const scoreElement = requireElement("score");
const linesElement = requireElement("lines");
const levelElement = requireElement("level");
const overlayElement = requireElement("stateOverlay");
const stateTitleElement = requireElement("stateTitle");
const stateButton = requireElement<HTMLButtonElement>("stateButton");
const playfieldPanel = requireElement("playfieldPanel");
const mainMenu = requireElement("mainMenu");
const mainPlayButton = requireElement<HTMLButtonElement>("mainPlayButton");
const mainConfigButton = requireElement<HTMLButtonElement>("mainConfigButton");
const mainRestartButton = requireElement<HTMLButtonElement>("mainRestartButton");
const clearToast = requireElement("clearToast");
const nextGrid = requireElement("nextPiece");
const menuButton = requireElement<HTMLButtonElement>("menuButton");
const soundButton = requireElement<HTMLButtonElement>("soundButton");
const settingsDialog = requireElement<HTMLDialogElement>("settingsDialog");
const closeMenuButton = requireElement<HTMLButtonElement>("closeMenuButton");
const doneMenuButton = requireElement<HTMLButtonElement>("doneMenuButton");
const resetBindingsButton = requireElement<HTMLButtonElement>("resetBindingsButton");
const bindingList = requireElement("bindingList");
const bindingStatus = requireElement("bindingStatus");
const nextCells = Array.from({ length: 16 }, () => {
  const cell = document.createElement("span");
  nextGrid.append(cell);
  return cell;
});
let mainMenuOpen = true;
let latestSnapshot: GameSnapshot | null = null;
let clearToastTimer = 0;
let gestureStart: { x: number; y: number; pointerId: number; time: number } | null = null;
const soundEngine = new SoundEngine();

renderBindingRows();
publishBindings();
syncSoundButton();
syncMainMenu();
syncMenuGate();

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
  const action = button.dataset.action as GameAction | undefined;

  if (action) {
    bindActionButton(button, action);
  }
}

bindPlayfieldGestures();

window.addEventListener("blockdrop:state", (event) => {
  renderHud((event as CustomEvent<GameSnapshot>).detail);
});

window.addEventListener("blockdrop:clear", (event) => {
  showClearToast((event as CustomEvent<GameSnapshot["lastClear"]>).detail);
});

window.addEventListener(SOUND_CUE_EVENT, (event) => {
  const detail = (event as CustomEvent<SoundCueDetail>).detail;
  soundEngine.play(detail.cue, detail.intensity);
});

document.addEventListener("pointerdown", () => void soundEngine.unlock(), { capture: true });
document.addEventListener("keydown", () => void soundEngine.unlock(), { capture: true });

menuButton.addEventListener("click", openMainMenu);
soundButton.addEventListener("click", () => {
  const muted = soundEngine.toggleMuted();
  syncSoundButton();

  if (!muted) {
    void soundEngine.unlock().then(() => soundEngine.play("toggle-sound"));
  }
});
mainPlayButton.addEventListener("click", () => {
  const shouldRestart = latestSnapshot?.status === "gameover";
  closeMainMenu();
  sendGameAction(shouldRestart ? "restart" : "start");
});
mainConfigButton.addEventListener("click", openSettings);
mainRestartButton.addEventListener("click", () => {
  closeMainMenu();
  sendGameAction("restart");
});
closeMenuButton.addEventListener("click", closeSettings);
doneMenuButton.addEventListener("click", closeSettings);
resetBindingsButton.addEventListener("click", () => {
  soundEngine.play("select");
  keyBindings = createDefaultKeyBindings();
  saveKeyBindings();
  publishBindings();
  pendingBindingAction = null;
  bindingStatus.textContent = "Defaults restored";
  renderBindingRows();
});

bindingList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-binding-action]");

  if (!button) {
    return;
  }

  pendingBindingAction = button.dataset.bindingAction as GameAction;
  bindingStatus.textContent = `Press a key for ${ACTION_LABELS[pendingBindingAction]}`;
  renderBindingRows();
  button.focus();
});

settingsDialog.addEventListener("cancel", (event) => {
  if (pendingBindingAction) {
    event.preventDefault();
    pendingBindingAction = null;
    bindingStatus.textContent = "";
    renderBindingRows();
    return;
  }

  event.preventDefault();
  closeSettings();
});

settingsDialog.addEventListener("close", () => {
  pendingBindingAction = null;
  bindingStatus.textContent = "";
  syncMenuGate();
  renderBindingRows();
});

window.addEventListener(
  "keydown",
  (event) => {
    if (!pendingBindingAction || !settingsDialog.open) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    assignKeyBinding(pendingBindingAction, event.code);
  },
  { capture: true }
);

function renderHud(snapshot: GameSnapshot): void {
  latestSnapshot = snapshot;
  scoreElement.textContent = snapshot.score.toLocaleString();
  linesElement.textContent = snapshot.lines.toLocaleString();
  levelElement.textContent = snapshot.level.toLocaleString();

  renderNextPiece(snapshot.nextType);
  renderOverlay(snapshot);
  syncMainMenu();
}

function renderNextPiece(type: PieceType | null): void {
  for (const cell of nextCells) {
    cell.removeAttribute("style");
    cell.dataset.filled = "false";
  }

  if (!type) {
    return;
  }

  const cells = PIECES[type][0];
  const color = PIECE_META[type].color;

  for (const pieceCell of cells) {
    const index = pieceCell.y * 4 + pieceCell.x;
    const cell = nextCells[index];

    if (cell) {
      cell.dataset.filled = "true";
      cell.style.setProperty("--piece-color", color);
    }
  }
}

function renderOverlay(snapshot: GameSnapshot): void {
  const isPaused = snapshot.status === "paused";
  const isGameOver = snapshot.status === "gameover";

  overlayElement.classList.toggle("is-hidden", mainMenuOpen || (!isPaused && !isGameOver));

  if (isPaused) {
    stateTitleElement.textContent = "Paused";
    stateButton.textContent = "Resume";
    stateButton.dataset.action = "pause";
  }

  if (isGameOver) {
    stateTitleElement.textContent = "Game Over";
    stateButton.textContent = "Restart";
    stateButton.dataset.action = "restart";
  }
}

function bindActionButton(button: HTMLButtonElement, action: GameAction): void {
  const holdable = action === "move-left" || action === "move-right" || action === "soft-drop";
  let repeatTimer = 0;
  let repeatDelay = 0;

  const send = (): void => {
    const currentAction = (button.dataset.action as GameAction | undefined) ?? action;
    sendGameAction(currentAction);
  };

  const stopRepeat = (): void => {
    window.clearTimeout(repeatDelay);
    window.clearInterval(repeatTimer);
  };

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    send();

    if (holdable) {
      repeatDelay = window.setTimeout(() => {
        repeatTimer = window.setInterval(send, 92);
      }, 180);
    }
  });

  button.addEventListener("pointerup", stopRepeat);
  button.addEventListener("pointercancel", stopRepeat);
  button.addEventListener("lostpointercapture", stopRepeat);
  button.addEventListener("keydown", (event) => {
    if (event.code === "Enter" || event.code === "Space") {
      event.preventDefault();
      send();
    }
  });
}

function bindPlayfieldGestures(): void {
  playfieldPanel.addEventListener("pointerdown", (event) => {
    if (mainMenuOpen || settingsDialog.open || event.pointerType === "mouse") {
      return;
    }

    if ((event.target as HTMLElement).closest("button, dialog")) {
      return;
    }

    gestureStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      time: window.performance.now()
    };
    playfieldPanel.setPointerCapture(event.pointerId);
  });

  playfieldPanel.addEventListener("pointerup", (event) => {
    if (!gestureStart || gestureStart.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - gestureStart.x;
    const dy = event.clientY - gestureStart.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const elapsed = window.performance.now() - gestureStart.time;
    gestureStart = null;

    if (mainMenuOpen || settingsDialog.open || elapsed > 900) {
      return;
    }

    if (Math.hypot(dx, dy) < 18) {
      sendGameAction("rotate-cw");
      return;
    }

    if (absX > absY && absX > 26) {
      sendGameAction(dx < 0 ? "move-left" : "move-right");
      return;
    }

    if (dy > 95) {
      sendGameAction("hard-drop");
      return;
    }

    if (dy > 28) {
      sendGameAction("soft-drop");
      return;
    }

    if (dy < -36) {
      sendGameAction("rotate-cw");
    }
  });

  playfieldPanel.addEventListener("pointercancel", () => {
    gestureStart = null;
  });
}

function openMainMenu(): void {
  soundEngine.play("menu");
  mainMenuOpen = true;
  syncMainMenu();
  syncMenuGate();
}

function closeMainMenu(): void {
  mainMenuOpen = false;
  syncMainMenu();
  syncMenuGate();
}

function syncMainMenu(): void {
  mainMenu.classList.toggle("is-hidden", !mainMenuOpen);

  if (!latestSnapshot) {
    mainPlayButton.textContent = "Start";
    return;
  }

  if (latestSnapshot.status === "gameover") {
    mainPlayButton.textContent = "Restart";
    return;
  }

  mainPlayButton.textContent = latestSnapshot.status === "ready" ? "Start" : "Resume";
}

function openSettings(): void {
  if (settingsDialog.open) {
    return;
  }

  soundEngine.play("select");
  pendingBindingAction = null;
  bindingStatus.textContent = "";
  renderBindingRows();
  settingsDialog.showModal();
  syncMenuGate();
}

function closeSettings(): void {
  if (settingsDialog.open) {
    soundEngine.play("select");
    settingsDialog.close();
  }
}

function syncSoundButton(): void {
  const muted = soundEngine.isMuted;

  soundButton.textContent = muted ? "Off" : "Snd";
  soundButton.classList.toggle("is-muted", muted);
  soundButton.setAttribute("aria-pressed", String(!muted));
  soundButton.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
  soundButton.title = muted ? "Turn sound on" : "Turn sound off";
}

function showClearToast(clear: GameSnapshot["lastClear"]): void {
  if (!clear) {
    return;
  }

  const labels = ["", "Line Clear", "Double Clear", "Triple Clear", "Quad Clear"];
  clearToast.textContent = clear.isQuad ? "Quad Clear!" : (labels[clear.count] ?? `${clear.count} Lines`);
  clearToast.classList.remove("is-hidden", "is-special", "is-showing");

  if (clear.isQuad) {
    clearToast.classList.add("is-special");
  }

  window.clearTimeout(clearToastTimer);
  window.requestAnimationFrame(() => {
    clearToast.classList.add("is-showing");
  });
  clearToastTimer = window.setTimeout(() => {
    clearToast.classList.remove("is-showing", "is-special");
    clearToast.classList.add("is-hidden");
  }, clear.isQuad ? 1400 : 950);
}

function renderBindingRows(): void {
  bindingList.replaceChildren();

  for (const action of GAME_ACTIONS) {
    const row = document.createElement("div");
    row.className = "binding-row";

    const label = document.createElement("span");
    label.textContent = ACTION_LABELS[action];

    const button = document.createElement("button");
    button.type = "button";
    button.className = "binding-key";
    button.dataset.bindingAction = action;
    button.textContent =
      pendingBindingAction === action ? "Press key" : keyBindings[action].map(formatKeyLabel).join(" / ");
    button.setAttribute("aria-label", `Change ${ACTION_LABELS[action]}`);

    if (pendingBindingAction === action) {
      button.classList.add("is-listening");
    }

    row.append(label, button);
    bindingList.append(row);
  }
}

function assignKeyBinding(action: GameAction, code: string): void {
  for (const otherAction of GAME_ACTIONS) {
    if (otherAction === action) {
      continue;
    }

    const remainingCodes = keyBindings[otherAction].filter((existingCode) => existingCode !== code);

    if (remainingCodes.length !== keyBindings[otherAction].length) {
      keyBindings[otherAction] =
        remainingCodes.length > 0
          ? remainingCodes
          : createDefaultKeyBindings()[otherAction].filter((defaultCode) => defaultCode !== code).slice(0, 1);
    }
  }

  keyBindings[action] = [code];
  pendingBindingAction = null;
  bindingStatus.textContent = `${ACTION_LABELS[action]} set to ${formatKeyLabel(code)}`;
  saveKeyBindings();
  publishBindings();
  renderBindingRows();
}

function loadKeyBindings(): KeyBindings {
  try {
    return normalizeKeyBindings(JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY) ?? "null"));
  } catch {
    return createDefaultKeyBindings();
  }
}

function saveKeyBindings(): void {
  try {
    localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(keyBindings));
  } catch {
    bindingStatus.textContent = "Settings saved for this session";
  }
}

function publishBindings(): void {
  const snapshot = cloneKeyBindings(keyBindings);
  window.blockDropKeyBindings = snapshot;
  window.dispatchEvent(new CustomEvent<KeyBindings>("blockdrop:bindings", { detail: snapshot }));
}

function sendGameAction(action: GameAction | "start"): void {
  if (action === "start") {
    window.dispatchEvent(new CustomEvent("blockdrop:start"));
    return;
  }

  window.dispatchEvent(new CustomEvent<GameAction>("blockdrop:action", { detail: action }));
}

function syncMenuGate(): void {
  const menuActive = mainMenuOpen || settingsDialog.open;
  document.body.classList.toggle("menu-active", menuActive);
  window.dispatchEvent(new CustomEvent("blockdrop:menu-state", { detail: { open: menuActive } }));
}

function cloneKeyBindings(bindings: KeyBindings): KeyBindings {
  return Object.fromEntries(GAME_ACTIONS.map((action) => [action, [...bindings[action]]])) as KeyBindings;
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing element #${id}`);
  }

  return element as T;
}
