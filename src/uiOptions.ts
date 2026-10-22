import React from 'react';

// DISPLAY OPTIONS (Adam, 2026-10-21): which REFERENCE surfaces fly.
// Instrumentation — the status strip, dock doors, gauges, warnings,
// CME banners, radar — is never optional; these toggles cover only
// the reference panels a pilot may find noisy. Display-only: an
// option never touches the sim, the net, or another player's view.
// Choices persist on THIS device (localStorage) and default ON.

export interface UiOptions {
  controlsCard: boolean; // SHIP CONTROLS card (desktop) + phone HELP legend
  astroPanel: boolean; // ASTRONOMIC DATA left panel (star fields + local nav)
  telemetry: boolean; // RANGE rows in the comms panel (PING/FPS graduated to the always-on chip, 2026-10-21)
  nameplates: boolean; // callsigns over remote ships (GameCanvas)
}

export const DEFAULT_UI_OPTIONS: UiOptions = {
  controlsCard: true,
  astroPanel: true,
  telemetry: true,
  nameplates: true,
};

const STORAGE_KEY = 'mr.uiOptions.v1';

function load(): UiOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_UI_OPTIONS, ...(JSON.parse(raw) as Partial<UiOptions>) };
  } catch {
    /* storage unavailable — defaults fly */
  }
  return { ...DEFAULT_UI_OPTIONS };
}

let snapshot: UiOptions = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* the choice still holds for this session */
  }
  listeners.forEach(l => l());
}

/** The current options — read directly by the canvas draw loop. */
export function getUiOptions(): UiOptions {
  return snapshot;
}

export function setUiOption<K extends keyof UiOptions>(key: K, value: UiOptions[K]): void {
  snapshot = { ...snapshot, [key]: value };
  persist();
}

export function resetUiOptions(): void {
  snapshot = { ...DEFAULT_UI_OPTIONS };
  persist();
}

/** React view of the options; re-renders when any toggle flips. */
export function useUiOptions(): UiOptions {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return snapshot;
}
