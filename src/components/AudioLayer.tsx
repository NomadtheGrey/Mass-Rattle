// SOUND LAYER (Adam, 2026-10-24 — the sounds pass, UI half).
// Synthesized WebAudio, NO audio asset files: every voice is a few
// oscillators + filtered noise built in code, so the push path stays
// text-only and every voice stays tunable in one place.
//
// RESTRAINT IS THE DESIGN: short voices, capped gains, one master
// gain from the Options volume, mute silences everything. These are
// game-true cues, not arcade noise — Adam's ear at the library is
// the judge, and the OPTIONS tab's HEAR ALL button lets him judge
// every voice without playing a match.
//
// LIFECYCLE: the AudioContext is created and resumed on a user
// gesture ONLY (ensureAudio is called from click handlers and the
// first-gesture listener the subscription layer adds later). Voices
// never block a frame: all scheduling is synchronous oscillator
// setup against ctx.currentTime, no awaits, no loads.
//
// The subscription layer (push 2, once BackGround's sim event hook
// lands) calls playVoice per event and setThrusting for the local
// ship's thrust loop. Nothing here reads the sim — the voices are
// pure functions of (type, loudness), and the hearing rule (own
// ship + nearby world) lives in the layer, not the synth.

import React from 'react';
import { getUiOptions } from '../uiOptions';
import { onSimEvents, type SimEvent } from '../sim/simEvents';
import type { ChatMessage } from '../net/protocol';

export type VoiceType =
  | 'fire' | 'hit' | 'explosion' | 'thrust'
  | 'scoop' | 'bank' | 'feed' | 'buy' | 'climb'
  | 'milestone' | 'starDamage' | 'cme' | 'decoy' | 'dock'
  | 'win' | 'lose' | 'ui' | 'chat';

let ctx: AudioContext | null = null;
// First-gesture gate: no context is even created before the player
// has gestured (click/key), so a pre-gesture frame never logs an
// autoplay warning and never schedules into a suspended context.
let unlocked = false;

/** Mark the player as having gestured; create + resume the context. */
export function unlockAudio(): void {
  unlocked = true;
  ensureAudio();
}
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let thrustNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

/** Create (or wake) the context. Call only from a user gesture. */
export function ensureAudio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function masterLevel(): void {
  if (!ctx || !master) return;
  const o = getUiOptions();
  const level = o.soundMuted ? 0 : (o.soundVolume ?? 80) / 100;
  master.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
}

interface ToneOpts {
  freq: number; freqEnd?: number; type?: OscillatorType;
  dur: number; vol: number; delay?: number;
}

function tone(o: ToneOpts): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + o.dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

interface NoiseOpts {
  dur: number; vol: number; from: number; to?: number; delay?: number; type?: BiquadFilterType;
}

function noise(o: NoiseOpts): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + (o.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.frequency.setValueAtTime(o.from, t);
  if (o.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + o.dur + 0.05);
}

/**
 * Play one voice. `loudness` (0..1) is the hearing rule's distance
 * falloff, applied by the subscription layer — 1 for own-ship and
 * UI sounds. Silent when muted; safe to call before any gesture
 * (it simply does nothing until ensureAudio has run).
 */
export function playVoice(type: VoiceType, loudness = 1): void {
  if (!unlocked || getUiOptions().soundMuted) return;
  const c = ensureAudio();
  if (!c || !master) return;
  masterLevel();
  const v = Math.min(1, Math.max(0, loudness));
  switch (type) {
    case 'fire':
      tone({ freq: 880, freqEnd: 220, type: 'square', dur: 0.09, vol: 0.10 * v });
      noise({ dur: 0.06, vol: 0.05 * v, from: 4000, to: 800, type: 'bandpass' });
      break;
    case 'hit':
      tone({ freq: 130, freqEnd: 55, dur: 0.12, vol: 0.22 * v });
      noise({ dur: 0.05, vol: 0.08 * v, from: 900, to: 300 });
      break;
    case 'explosion':
      noise({ dur: 0.5, vol: 0.30 * v, from: 3000, to: 120 });
      tone({ freq: 90, freqEnd: 30, dur: 0.5, vol: 0.28 * v });
      break;
    case 'scoop':
      tone({ freq: 660, freqEnd: 990, dur: 0.12, vol: 0.12 * v });
      break;
    case 'bank':
      tone({ freq: 880, dur: 0.10, vol: 0.12 * v });
      tone({ freq: 1320, dur: 0.14, vol: 0.12 * v, delay: 0.09 });
      break;
    case 'feed':
      tone({ freq: 660, dur: 0.12, vol: 0.12 * v });
      tone({ freq: 880, dur: 0.12, vol: 0.12 * v, delay: 0.10 });
      tone({ freq: 1100, dur: 0.16, vol: 0.12 * v, delay: 0.20 });
      break;
    case 'buy':
      tone({ freq: 740, type: 'triangle', dur: 0.08, vol: 0.13 * v });
      tone({ freq: 1108, type: 'triangle', dur: 0.08, vol: 0.13 * v, delay: 0.07 });
      tone({ freq: 1480, type: 'triangle', dur: 0.12, vol: 0.13 * v, delay: 0.14 });
      break;
    case 'climb':
      tone({ freq: 300, freqEnd: 900, type: 'sawtooth', dur: 0.4, vol: 0.08 * v });
      tone({ freq: 600, freqEnd: 1800, dur: 0.4, vol: 0.10 * v, delay: 0.05 });
      break;
    case 'milestone':
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, dur: 0.3, vol: 0.12 * v, delay: i * 0.11 }));
      break;
    case 'starDamage':
      tone({ freq: 70, freqEnd: 40, dur: 0.3, vol: 0.30 * v });
      tone({ freq: 74, freqEnd: 42, dur: 0.3, vol: 0.20 * v, delay: 0.05 });
      break;
    case 'cme':
      noise({ dur: 1.4, vol: 0.16 * v, from: 200, to: 90 });
      tone({ freq: 50, freqEnd: 36, dur: 1.4, vol: 0.18 * v });
      break;
    case 'decoy':
      tone({ freq: 500, freqEnd: 750, type: 'square', dur: 0.08, vol: 0.07 * v });
      tone({ freq: 750, freqEnd: 500, type: 'square', dur: 0.08, vol: 0.07 * v, delay: 0.09 });
      tone({ freq: 500, freqEnd: 750, type: 'square', dur: 0.08, vol: 0.07 * v, delay: 0.18 });
      break;
    case 'dock':
      noise({ dur: 0.08, vol: 0.12 * v, from: 500, to: 200 });
      tone({ freq: 440, dur: 0.2, vol: 0.12 * v, delay: 0.06 });
      break;
    case 'win':
      [523, 659, 784, 1047, 1319].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.35, vol: 0.14 * v, delay: i * 0.12 }));
      break;
    case 'lose':
      [392, 330, 262, 196].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.4, vol: 0.13 * v, delay: i * 0.16 }));
      break;
    case 'ui':
      tone({ freq: 1200, type: 'square', dur: 0.03, vol: 0.04 * v });
      break;
    case 'chat':
      tone({ freq: 880, dur: 0.08, vol: 0.08 * v });
      tone({ freq: 880, dur: 0.08, vol: 0.08 * v, delay: 0.12 });
      break;
    case 'thrust':
      // The thrust voice is a loop, not a one-shot — use setThrusting.
      break;
  }
}

/**
 * The thrust loop: looped filtered noise whose gain follows thrust
 * input. Local ship only — the subscription layer gates this on the
 * local thrust state, never on remote ships.
 */
export function setThrusting(on: boolean): void {
  if (!unlocked) return;
  if (getUiOptions().soundMuted) {
    on = false;
  }
  const c = ensureAudio();
  if (!c || !master || !noiseBuf) return;
  masterLevel();
  if (on && !thrustNodes) {
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.setTargetAtTime(0.10, c.currentTime, 0.08);
    src.connect(f).connect(g).connect(master);
    src.start();
    thrustNodes = { src, gain: g };
  } else if (!on && thrustNodes) {
    const { src, gain } = thrustNodes;
    thrustNodes = null;
    gain.gain.setTargetAtTime(0, c.currentTime, 0.08);
    window.setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, 400);
  }
}

/** HEAR ALL (Options tab): every voice in turn, so Adam can judge
 *  the set without playing a match. Thrust gets a half-second loop. */
export function playAllVoices(): void {
  unlockAudio();
  const c = ensureAudio();
  if (!c) return;
  const voices: VoiceType[] = [
    'fire', 'hit', 'explosion', 'scoop', 'bank', 'feed', 'buy', 'climb',
    'milestone', 'starDamage', 'cme', 'decoy', 'dock', 'win', 'lose', 'ui', 'chat',
  ];
  voices.forEach((v, i) => window.setTimeout(() => playVoice(v), i * 450));
  window.setTimeout(() => setThrusting(true), voices.length * 450);
  window.setTimeout(() => setThrusting(false), voices.length * 450 + 600);
}

// SOUND LAYER (Adam, 2026-10-24 — sounds pass, UI half, part 2).
// Subscribes ONCE to BackGround's sim event hook (acbc489) and
// turns events into voices under the hearing rule:
//   - an event owned by the local seat plays at full volume;
//   - any other event with a world position plays only within
//     earshot (800 units): full within 250, linear falloff to
//     silence at 800; beyond that it never reaches the ear;
//   - an event with neither a local owner nor a position is
//     skipped (it cannot be placed).
// Solo, host, and guest all arrive through the one listener — the
// host's snapshot batches feed the same listener on guests, so
// the layer needs no guest special-casing. Win/lose come from
// App's isVictory/isGameOver props (no match_end in the hook, by
// the frozen contract); chat blips on others' messages only; the
// thrust loop gates on the local ship's fuel-gated thrust flag.
// The UI voice ships in the synth (HEAR ALL proves it) but stays
// unwired in v1 — button clicks are not sim events, and wiring
// every door is a follow-up if Adam wants clicks.
const EARSHOT = 800;
const EARSHOT_FULL = 250;

export const SoundLayer: React.FC<{
  localOwnerId: string;
  localShipPos: { x: number; y: number } | null;
  localThrusting: boolean;
  chatLog: ChatMessage[];
  isVictory: boolean;
  isGameOver: boolean;
}> = ({ localOwnerId, localShipPos, localThrusting, chatLog, isVictory, isGameOver }) => {
  const ownerRef = React.useRef(localOwnerId);
  const posRef = React.useRef(localShipPos);
  const thrustRef = React.useRef(localThrusting);
  React.useEffect(() => {
    ownerRef.current = localOwnerId;
    posRef.current = localShipPos;
    thrustRef.current = localThrusting;
  });
  // One subscription for the life of the mount.
  React.useEffect(() => onSimEvents((events: SimEvent[]) => {
    const owner = ownerRef.current;
    const lp = posRef.current;
    for (const ev of events) {
      if (ev.ownerId === owner) {
        playVoice(ev.type, 1);
        continue;
      }
      if (ev.x === undefined || ev.y === undefined || !lp) continue;
      const d = Math.hypot(ev.x - lp.x, ev.y - lp.y);
      if (d >= EARSHOT) continue;
      const loud = d <= EARSHOT_FULL ? 1 : 1 - (d - EARSHOT_FULL) / (EARSHOT - EARSHOT_FULL);
      playVoice(ev.type, loud);
    }
  }), []);
  // Thrust loop follows the local flag's edges only.
  const prevThrust = React.useRef(false);
  React.useEffect(() => {
    if (localThrusting !== prevThrust.current) {
      prevThrust.current = localThrusting;
      setThrusting(localThrusting);
    }
  }, [localThrusting]);
  // Win/lose stingers fire once, on the game-over edge.
  const prevOver = React.useRef(false);
  React.useEffect(() => {
    if (isGameOver && !prevOver.current) playVoice(isVictory ? 'win' : 'lose');
    prevOver.current = isGameOver;
  }, [isGameOver, isVictory]);
  // Chat blip on others' messages only — never your own echo.
  const prevChatLen = React.useRef(chatLog.length);
  React.useEffect(() => {
    if (chatLog.length > prevChatLen.current) {
      const latest = chatLog[chatLog.length - 1];
      if (latest && latest.ownerId !== ownerRef.current) playVoice('chat');
    }
    prevChatLen.current = chatLog.length;
  }, [chatLog]);
  // First gesture unlocks the context (and re-syncs thrust, in
  // case the player was already holding thrust when it unlocked).
  React.useEffect(() => {
    const unlock = () => {
      unlockAudio();
      setThrusting(thrustRef.current);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  return null;
};
