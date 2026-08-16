import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Rocket, Magnet, Disc, Wrench, Navigation, Gauge, ChevronLeft, ChevronRight } from 'lucide-react';

interface MobileControlsProps {
  onControlChange: (action: 'thrust' | 'rotateLeft' | 'rotateRight' | 'vac' | 'jettison', active: boolean) => void;
  onAnalogStick: (stick: { x: number; y: number } | null) => void;
  onOpenWorkshop: () => void;
  onToggleRadar: () => void;
  onToggleGauges: () => void;
  carrying: number;
  fuel: number;
  maxFuel: number;
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
}) => {
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

  const createTouchButtonHandler = (action: 'thrust' | 'rotateLeft' | 'rotateRight' | 'vac' | 'jettison') => {
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
            className="pitted-metal px-2.5 py-1.5 flex items-center gap-1.5 text-[#33ff33] text-[10px] font-mono border border-zinc-700 bg-zinc-900/90 active:scale-95 transition-transform shadow-md rounded"
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
            className="pitted-metal px-2.5 py-1.5 flex items-center gap-1.5 text-[#33ff33] text-[10px] font-mono border border-zinc-700 bg-zinc-900/90 active:scale-95 transition-transform shadow-md rounded"
            title="Toggle Analog/Digital Gauges"
          >
            <Gauge size={12} className="text-cyan-400" />
            <span>GAUGES</span>
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
                  stickActive ? 'border-[#33ff33]/80 bg-zinc-900/90 shadow-[0_0_25px_rgba(51,255,51,0.2)]' : ''
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

        {/* Right Side: Action Cluster */}
        <div className="flex items-center gap-2 sm:gap-3">
          
          {/* Column 1: VAC & JETTISON */}
          <div className="flex flex-col gap-2">
            {/* JETTISON Button */}
            <button
              {...jettisonHandlers}
              disabled={carrying <= 0}
              className={`w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 flex flex-col items-center justify-center transition-all touch-none ${
                carrying > 0
                  ? 'border-red-600 bg-red-950/40 text-red-500 active:bg-red-900 active:scale-95 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                  : 'border-zinc-800 bg-zinc-950/50 text-zinc-600 opacity-40 grayscale cursor-not-allowed'
              }`}
            >
              <Disc size={16} className={carrying > 0 ? 'text-red-400 animate-spin' : ''} />
              <span className="text-[8px] font-mono font-bold uppercase tracking-tight mt-0.5">EJECT</span>
            </button>

            {/* VAC Button */}
            <button
              {...vacHandlers}
              className="w-14 h-12 sm:w-16 sm:h-14 pitted-metal rounded-lg border-2 border-emerald-600/80 bg-emerald-950/30 text-[#33ff33] active:bg-emerald-900/60 active:border-[#33ff33] active:scale-95 flex flex-col items-center justify-center shadow-[0_0_12px_rgba(51,255,51,0.2)] touch-none"
            >
              <Magnet size={16} className="text-[#33ff33]" />
              <span className="text-[8px] font-mono font-bold uppercase tracking-tight mt-0.5">VAC PULL</span>
            </button>
          </div>

          {/* Column 2: Big Primary THRUST Button */}
          <button
            {...thrustHandlers}
            className="w-18 h-26 sm:w-20 sm:h-28 pitted-metal rounded-xl border-2 border-orange-600/80 bg-gradient-to-b from-orange-950/60 to-zinc-950 text-orange-400 active:from-orange-700 active:to-orange-900 active:border-orange-400 active:text-white active:scale-95 flex flex-col items-center justify-center gap-1 shadow-[0_0_20px_rgba(234,88,12,0.3)] touch-none relative overflow-hidden"
          >
            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-orange-500 animate-ping opacity-75" />
            <Rocket size={26} className="text-orange-400 transform -rotate-45" />
            <span className="text-[11px] font-mono font-black uppercase tracking-wider text-orange-300">THRUST</span>
            <span className="text-[7px] font-mono opacity-60">HOLD ENG</span>
          </button>
        </div>

      </div>
    </div>
  );
};
