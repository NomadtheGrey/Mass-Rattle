import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Rocket, Magnet, Disc, Wrench, Navigation, Gauge, ChevronLeft, ChevronRight, Download, Upload, Landmark, Radio, Info, Star } from 'lucide-react';
import { getLoadoutItem } from '../loadout';
import { useUiOptions } from '../uiOptions';

interface MobileControlsProps {
  onControlChange: (action: 'thrust' | 'rotateLeft' | 'rotateRight' | 'vac' | 'jettison' | 'fire', active: boolean) => void;
  onAnalogStick: (stick: { x: number; y: number } | null) => void;
  onOpenWorkshop: () => void;
  onToggleRadar: () => void;
  onToggleGauges: () => void;
  carrying: number;
  fuel: number;
  maxFuel: number;
  // CONTEXTUAL CONTROLS (UI chat try-out, Adam's go-ahead 2026-10-19):
  // a control only exists while it is usable. No dead buttons.
  /** Equipped weapon id (ship.loadout.weapon); null = unarmed, no FIRE tile. */
  weaponId: string | null;
  /** True inside the home star's bank well: the combat cluster becomes the dock. */
  inWell: boolean;
  bankedScrap: number;
  onFeedCargo: () => void;
  onDepositBank: () => void;
  onWithdrawBank: () => void;
  /** Decoy Beacon equipped + not yet out: the one manual DEPLOY tile shows. */
  decoyEquipped: boolean;
  decoyActive: boolean;
  onDeployDecoy: () => void;
  repairing: boolean;
  activelyRepairing: boolean;
  onToggleRepair: () => void;
}

export const MobileControls: React.FC<MobileControlsProps> = ({
  onControlChange,
  onAnalogStick,
  onOpenWorkshop,
  onToggleRadar,
  onToggleGauges,
  carrying,
  fuel,
  maxFuel,
  weaponId,
  inWell,
  bankedScrap,
  onFeedCargo,
  onDepositBank,
  onWithdrawBank,
  decoyEquipped,
  decoyActive,
  onDeployDecoy,
  repairing,
  activelyRepairing,
  onToggleRepair,
}) => {
  const weaponDef = getLoadoutItem(weaponId);
  const isMineLayer = weaponDef?.id === 'mine_layer';
  // Touch-controls legend (HELP button in the top row): the phone's
  // CONTROLS card — closed by default, so it costs no screen until asked.
  const [showHelp, setShowHelp] = useState(false);
  const uiOptions = useUiOptions();
  const joystickRef = useRef<HTMLDivElement>(null);
  const [stickActive, setStickActive] = useState(false);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  const joyCenter = useRef({ x: 0, y: 0 });
  const [useDpadMode, setUseDpadMode] = useState(false);

  // Trigger brief haptic vibration if supported
  const triggerHaptic = useCallback((ms = 15) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(ms);
      }
    } catch {
      // Ignore vibration errors
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickRef.current) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    joyCenter.current = { x: centerX, y: centerY };

    activePointerId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setStickActive(true);
    triggerHaptic(10);

    handlePointerMove(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== e.pointerId) return;

    const maxRadius = 42;
    const dx = e.clientX - joyCenter.current.x;
    const dy = e.clientY - joyCenter.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);

    const nx = Math.cos(angle) * (clampedDist / maxRadius);
    const ny = Math.sin(angle) * (clampedDist / maxRadius);

    setStickPos({
      x: Math.cos(angle) * clampedDist,
      y: Math.sin(angle) * clampedDist,
    });

    onAnalogStick({ x: nx, y: ny });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current === e.pointerId) {
      activePointerId.current = null;
      setStickActive(false);
      setStickPos({ x: 0, y: 0 });
      onAnalogStick(null);
    }
  };

  const createTouchButtonHandler = (action: 'thrust' | 'rotateLeft' | 'rotateRight' | 'vac' | 'jettison' | 'fire') => {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        triggerHaptic(action === 'jettison' ? 25 : 12);
        onControlChange(action, true);
      },
      onPointerUp: (e: React.PointerEvent) => {
        e.preventDefault();
        onControlChange(action, false);
      },
      onPointerCancel: (e: React.PointerEvent) => {
        e.preventDefault();
        onControlChange(action, false);
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  };

  const fireHandlers = createTouchButtonHandler('fire');
  const thrustHandlers = createTouchButtonHandler('thrust');
  const vacHandlers = createTouchButtonHandler('vac');
  const jettisonHandlers = createTouchButtonHandler('jettison');
  const leftHandlers = createTouchButtonHandler('rotateLeft');
  const rightHandlers = createTouchButtonHandler('rotateRight');

  return (
    <div className="fixed inset-x-0 bottom-0 pointer-events-none z-40 pb-2 px-2 sm:px-4 md:hidden select-none">
      {/* Top Mobile Quick Actions Row */}
      <div className="flex justify-between items-center mb-2 px-1 pointer-events-auto">
        {/* Radar & Gauges toggles */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              triggerHaptic(10);
              onToggleRadar();
            }}
            className="pitted-metal px-2.5 py-1.5 flex items-center gap-1.5 text-[#33ff33] text-[10px] font-mono border border-zinc-700 bg-zinc-900/70 active:scale-95 transition-transform shadow-md rounded"
            title="Toggle Tactical Radar"
          >
            <Navigation size={12} className="text-orange-400" />
            <span>RADAR</span>
          </button>
          
          <button
            onClick={() => {
              triggerHaptic(10);
              onToggleGauges();
            }}
            className="pitted-metal px-2.5 py-1.5 flex items-center gap-1.5 text-[#33ff33] text-[10px] font-mono border border-zinc-700 bg-zinc-900/70 active:scale-95 transition-transform shadow-md rounded"
            title="Toggle Analog/Digital Gauges"
          >
            <Gauge size={12} className="text-cyan-400" />
            <span>GAUGES</span>
          </button>

          <button
            onClick={() => {
              triggerHaptic(10);
              setShowHelp(prev => !prev);
            }}
            className={`pitted-metal px-2.5 py-1.5 flex items-center gap-1.5 text-[10px] font-mono border bg-zinc-900/70 active:scale-95 transition-transform shadow-md rounded ${showHelp ? 'text-white border-[#33ff33]' : 'text-[#33ff33] border-zinc-700'} ${uiOptions.controlsCard ? '' : 'hidden'}`}
            title="Touch controls legend"
          >
            <Info size={12} className="text-amber-400" />
            <span>HELP</span>
          </button>
        </div>

        {/* Workshop button */}
        <button
          onClick={() => {
            triggerHaptic(20);
            onOpenWorkshop();
          }}
          className="pitted-metal px-3 py-1.5 flex items-center gap-2 border border-pink-700/60 bg-pink-950/40 text-pink-400 text-[10px] font-mono font-bold active:scale-95 transition-transform shadow-lg rounded animate-pulse"
        >
          <Wrench size={13} className="text-pink-400" />
          <span>WORKSHOP [{carrying}U]</span>
        </button>
      </div>

      {/* Touch-controls legend — the phone CONTROLS card. Rows describe
          the tiles as they actually behave now (contextual included):
          if a tile is not on screen, it is not usable right now. */}
      {showHelp && uiOptions.controlsCard && (
        <div className="mx-1 mb-2 pitted-metal border border-zinc-700 bg-zinc-950/85 rounded p-3 pointer-events-auto shadow-2xl">
          <div className="text-[8px] font-mono font-bold tracking-[0.25em] text-zinc-500 mb-1.5">TOUCH CONTROLS</div>
          <div className="flex flex-col gap-1">
            {[
              { label: 'STICK · LEFT', keys: 'STEER — PUSH TO THRUST' },
              { label: 'THRUST · HOLD', keys: 'MAIN ENGINE' },
              weaponDef
                ? { label: `${isMineLayer ? 'DROP' : 'FIRE'} · HOLD`, keys: weaponDef.name.toUpperCase() }
                : { label: 'FIRE · HOLD', keys: 'NO WEAPON EQUIPPED', dim: true },
              { label: 'VAC PULL · HOLD', keys: 'COLLECT SCRAP' },
              { label: 'EJECT', keys: 'CARGO PULSE — SHOWS WHEN CARRYING' },
              ...(decoyEquipped ? [{ label: 'DECOY ▸ DROP', keys: 'DROPS THE BEACON' }] : []),
              { label: 'IN THE WELL', keys: 'FEED · BANK · WITHDRAW · WORKSHOP' },
              { label: 'WORKSHOP', keys: 'SHOP + UPGRADES — AT YOUR STAR' },
            ].map(row => (
              <div key={row.label} className="flex justify-between gap-3 text-[9px] font-mono">
                <span className={`${row.dim ? 'text-zinc-500' : 'text-zinc-400'} tracking-wider whitespace-nowrap`}>{row.label}</span>
                <span className={`${row.dim ? 'text-zinc-500' : 'text-[#33ff33]'} font-bold text-right`}>{row.keys}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Touch Controls Bar */}
      <div className="flex items-end justify-between w-full pointer-events-auto">
        
        {/* Left Side: Virtual Joystick or D-Pad */}
        <div className="flex flex-col items-center">
          {!useDpadMode ? (
            <div className="relative">
              {/* Virtual Flight Joystick */}
              <div
                ref={joystickRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={`w-28 h-28 rounded-full border-2 border-zinc-700/80 bg-zinc-950/80 backdrop-blur-md relative flex items-center justify-center shadow-[0_0_20px_rgba(0,0,0,0.8)] touch-none select-none transition-colors ${
                  stickActive ? 'border-[#33ff33]/80 bg-zinc-900/70 shadow-[0_0_25px_rgba(51,255,51,0.2)]' : ''
                }`}
              >
                {/* Crosshairs */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-25">
                  <div className="w-full h-px bg-[#33ff33]" />
                  <div className="h-full w-px bg-[#33ff33] absolute" />
                </div>
                
                {/* Center Ring */}
                <div className="w-14 h-14 rounded-full border border-dashed border-[#33ff33]/30 pointer-events-none" />

                {/* Joystick Nub */}
                <div
                  className={`w-12 h-12 rounded-full pitted-metal border-2 flex items-center justify-center pointer-events-none transition-transform duration-75 shadow-lg ${
                    stickActive 
                      ? 'border-[#33ff33] bg-zinc-800 text-[#33ff33] shadow-[0_0_15px_#33ff33]' 
                      : 'border-zinc-600 bg-zinc-900 text-zinc-400'
                  }`}
                  style={{
                    transform: `translate(${stickPos.x}px, ${stickPos.y}px)`,
                  }}
                >
                  <Rocket size={16} className={stickActive ? 'text-[#33ff33]' : 'text-zinc-500'} />
                </div>
              </div>

              {/* Sublabel & toggle to D-Pad */}
              <div className="flex justify-between items-center mt-1 px-1 text-[8px] font-mono text-zinc-500">
                <span className="uppercase tracking-widest text-[#33ff33]/70 font-bold">FLIGHT STICK</span>
                <button 
                  onClick={() => setUseDpadMode(true)} 
                  className="text-zinc-400 hover:text-[#33ff33] underline uppercase"
                >
                  D-PAD
                </button>
              </div>
            </div>
          ) : (
            /* Discrete D-Pad Mode */
            <div className="flex flex-col items-center">
              <div className="flex gap-2">
                <button
                  {...leftHandlers}
                  className="w-14 h-14 pitted-metal flex flex-col items-center justify-center border-2 border-zinc-700 bg-zinc-900 active:bg-zinc-800 active:border-[#33ff33] text-[#33ff33] rounded-lg shadow-lg touch-none"
                >
                  <ChevronLeft size={20} />
                  <span className="text-[7px] font-mono font-bold">LEFT</span>
                </button>

                <button
                  {...rightHandlers}
                  className="w-14 h-14 pitted-metal flex flex-col items-center justify-center border-2 border-zinc-700 bg-zinc-900 active:bg-zinc-800 active:border-[#33ff33] text-[#33ff33] rounded-lg shadow-lg touch-none"
                >
                  <ChevronRight size={20} />
                  <span className="text-[7px] font-mono font-bold">RIGHT</span>
                </button>
              </div>
              <div className="flex justify-between items-center w-full mt-1 px-1 text-[8px] font-mono text-zinc-500">
                <span className="uppercase text-[#33ff33]/70 font-bold">STEER D-PAD</span>
                <button 
                  onClick={() => setUseDpadMode(false)} 
                  className="text-zinc-400 hover:text-[#33ff33] underline uppercase"
                >
                  STICK
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Action Cluster — CONTEXTUAL (UI chat try-out):
            in the well this whole side becomes the dock; in the field a
            tile exists only while it can actually be used. */}
        <div className="flex items-center gap-2 sm:gap-3">

          {inWell ? (
            /* Column 1 (docked): THE CHOICE (Adam's pin, 2026-10-20) —
               FEED the star or BANK the load, both one tap, both only
               inside the well anyway. The WORKSHOP button in the top row
               opens the (well-gated) shop itself. */
            <div className="flex flex-col gap-2">
              {carrying > 0 && (
                <button
                  onClick={() => { triggerHaptic(20); onFeedCargo(); }}
                  className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-amber-500/80 bg-amber-950/40 text-amber-300 active:bg-amber-900/60 active:scale-95 flex flex-col items-center justify-center shadow-[0_0_12px_rgba(251,191,36,0.3)] touch-none"
                >
                  <Star size={16} className="text-amber-300" />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">FEED</span>
                  <span className="text-[8px] font-mono">ALL {carrying}U</span>
                </button>
              )}
              {carrying > 0 && (
                <button
                  onClick={() => { triggerHaptic(20); onDepositBank(); }}
                  className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-pink-600/80 bg-pink-950/40 text-pink-400 active:bg-pink-900/60 active:scale-95 flex flex-col items-center justify-center shadow-[0_0_12px_rgba(236,72,153,0.3)] touch-none"
                >
                  <Download size={16} className="text-pink-400" />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">BANK</span>
                  <span className="text-[8px] font-mono">ALL {carrying}U</span>
                </button>
              )}
              {bankedScrap > 0 && (
                <button
                  onClick={() => { triggerHaptic(20); onWithdrawBank(); }}
                  className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-cyan-600/80 bg-cyan-950/40 text-cyan-300 active:bg-cyan-900/60 active:scale-95 flex flex-col items-center justify-center shadow-[0_0_12px_rgba(34,211,238,0.25)] touch-none"
                >
                  <Upload size={16} className="text-cyan-300" />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">WITHDRAW</span>
                  <span className="text-[8px] font-mono">BANK {bankedScrap}U</span>
                </button>
              )}
              {carrying <= 0 && bankedScrap <= 0 && (
                <div className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-zinc-800 bg-zinc-950/50 text-zinc-500 flex flex-col items-center justify-center">
                  <Landmark size={16} />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">DOCKED</span>
                </div>
              )}
            </div>
          ) : (
            /* Column 1 (field): EJECT only while carrying, VAC always,
               DECOY only while an undeployed beacon is equipped. */
            <div className="flex flex-col gap-2">
              {/* JETTISON Button — gone entirely at zero cargo (was a greyed dead tile) */}
              {carrying > 0 && (
                <button
                  {...jettisonHandlers}
                  className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-red-600 bg-red-950/40 text-red-400 active:bg-red-900 active:scale-95 flex flex-col items-center justify-center transition-all touch-none shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                >
                  <Disc size={16} className="text-red-400 animate-spin" />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">EJECT</span>
                </button>
              )}

              {/* VAC Button */}
              <button
                {...vacHandlers}
                className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-emerald-600/80 bg-emerald-950/30 text-[#33ff33] active:bg-emerald-900/60 active:border-[#33ff33] active:scale-95 flex flex-col items-center justify-center shadow-[0_0_12px_rgba(51,255,51,0.2)] touch-none"
              >
                <Magnet size={16} className="text-[#33ff33]" />
                <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">VAC PULL</span>
              </button>

              {/* REPAIR toggle tile — Damage Control's in-play
                  switch (the workshop carries the full law; the
                  tile just turns the mode and reads its state). */}
              <button
                onClick={() => { triggerHaptic(20); onToggleRepair(); }}
                className={`w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 active:scale-95 flex flex-col items-center justify-center transition-all touch-none ${activelyRepairing ? 'border-[#33ff33] bg-emerald-950/40 text-[#33ff33] shadow-[0_0_12px_rgba(51,255,51,0.3)]' : repairing ? 'border-cyan-600/80 bg-cyan-950/30 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]' : 'border-zinc-700 bg-zinc-950/40 text-zinc-500'}`}
              >
                <Wrench size={16} />
                <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">{activelyRepairing ? 'PATCHING' : repairing ? 'REPAIR ON' : 'REPAIR OFF'}</span>
              </button>

              {/* DECOY deploy tile — the one manual deployable wears its own
                  name here, only until it is out (then it leaves). */}
              {decoyEquipped && !decoyActive && (
                <button
                  onClick={() => { triggerHaptic(20); onDeployDecoy(); }}
                  className="w-14 h-10 sm:w-16 pitted-metal rounded-lg border-2 border-amber-600/80 bg-amber-950/40 text-amber-300 active:bg-amber-900/60 active:scale-95 flex flex-col items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.25)] touch-none"
                >
                  <Radio size={14} className="text-amber-300" />
                  <span className="text-[9px] font-mono font-bold uppercase tracking-tight mt-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">DECOY ▸ DROP</span>
                </button>
              )}
            </div>
          )}

          {/* Column 2: FIRE — only while armed, and never in the well
              (guns put away at home; the dock column takes this space).
              The tile wears the equipped weapon: its icon, FIRE — or DROP
              for the Mine Layer — and its name. */}
          {weaponDef && !inWell && (
            <button
              {...fireHandlers}
              className="w-14 h-26 sm:w-16 sm:h-28 pitted-metal rounded-xl border-2 border-red-600/80 bg-gradient-to-b from-red-950/60 to-zinc-950 text-red-400 active:from-red-700 active:to-red-900 active:border-red-400 active:text-white active:scale-95 flex flex-col items-center justify-center gap-1 shadow-[0_0_20px_rgba(239,68,68,0.3)] touch-none"
            >
              <span className="text-[22px] leading-none" aria-hidden>{weaponDef.icon}</span>
              <span className="text-[10px] font-mono font-black uppercase tracking-wider text-red-300">{isMineLayer ? 'DROP' : 'FIRE'}</span>
              <span className="text-[7px] font-mono uppercase text-center leading-tight px-0.5 text-red-200">{weaponDef.name}</span>
            </button>
          )}

          {/* Column 3: Big Primary THRUST Button */}
          <button
            {...thrustHandlers}
            className="w-18 h-26 sm:w-20 sm:h-28 pitted-metal rounded-xl border-2 border-orange-600/80 bg-gradient-to-b from-orange-950/60 to-zinc-950 text-orange-400 active:from-orange-700 active:to-orange-900 active:border-orange-400 active:text-white active:scale-95 flex flex-col items-center justify-center gap-1 shadow-[0_0_20px_rgba(234,88,12,0.3)] touch-none relative overflow-hidden"
          >
            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-orange-500 animate-ping opacity-75" />
            <Rocket size={26} className="text-orange-400 transform -rotate-45" />
            <span className="text-[11px] font-mono font-black uppercase tracking-wider text-orange-300">THRUST</span>
            <span className="text-[8px] font-mono">HOLD ENG</span>
          </button>
        </div>

      </div>
    </div>
  );
};
