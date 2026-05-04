import { motion } from 'motion/react';
import React from 'react';

interface NeedleGaugeProps {
  value: number;
  max: number;
  label: string;
  color: string;
}

const NeedleGauge: React.FC<NeedleGaugeProps> = ({ value, max, label, color }) => {
  const percent = Math.min(value / max, 1.2);
  const rotation = (percent * 180) - 90; 
  const jitter = (Math.random() - 0.5) * 1.5;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-12 overflow-hidden border-b-2 border-zinc-800">
        <div className="absolute bottom-0 left-0 w-full h-24 border-8 border-t-zinc-800 border-l-zinc-800 border-r-zinc-800 rounded-full opacity-20" />
        <motion.div 
          className="absolute bottom-0 left-1/2 w-0.5 h-14 origin-bottom -translate-x-1/2"
          style={{ backgroundColor: color, rotate: rotation + jitter }}
          transition={{ type: 'spring', damping: 12, stiffness: 90 }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#0a0a0c] border border-zinc-700 z-10" />
      </div>
      <div className="embossed-label mt-2" style={{ backgroundColor: '#222', border: '1px solid #444' }}>{label}</div>
    </div>
  );
};

interface HUDProps {
  starMass: number;
  velocity: number;
  glitch: boolean;
  carrying: number;
  teamScrap: number;
  totalScrapInfused: number;
  fuel: number;
  maxFuel: number;
  useAnalogGauges: boolean;
  shipPos: { x: number; y: number };
  starPos: { x: number; y: number };
  enemyStarPos: { x: number; y: number };
  scrapList: { pos: { x: number; y: number } }[];
  upgrades: { thrust: number; handling: number; attractor: number; fuelCap: number };
  onUpgrade: (type: 'thrust' | 'handling' | 'attractor' | 'fuel') => void;
}

export const HUD: React.FC<HUDProps> = ({ 
  starMass, 
  velocity, 
  glitch, 
  carrying, 
  teamScrap,
  totalScrapInfused,
  fuel,
  maxFuel,
  useAnalogGauges,
  shipPos,
  starPos,
  enemyStarPos,
  scrapList,
  upgrades,
  onUpgrade
}) => {
  const growthProgress = (totalScrapInfused % 100);
  const starLevel = Math.floor(totalScrapInfused / 100) + 1;
  const [showSysCfg, setShowSysCfg] = React.useState(false);

  // Minimap logic
  const mapScale = 0.025;
  const mapCenter = { x: 50, y: 50 };

  const getMapPos = (pos: { x: number; y: number }) => ({
    x: mapCenter.x + (pos.x - shipPos.x) * mapScale * 100,
    y: mapCenter.y + (pos.y - shipPos.y) * mapScale * 100,
  });

  const homeMap = getMapPos(starPos);
  const enemyMap = getMapPos(enemyStarPos);

  return (
    <div className={`fixed inset-0 pointer-events-none z-50 flex p-6 gap-6 ${glitch ? 'animate-pulse' : ''} text-[#33ff33]`}>
      {/* Left Aside */}
      <aside className="w-[225px] min-w-[225px] flex flex-col gap-4">
        <div className="hud-panel p-4 border-4">
          <div className="absolute top-0 right-0 p-1 text-[10px] text-[#2d2d30]">MOD-CR90</div>
          <h2 className="mb-4 pb-1 font-bold">
            <span className="embossed-label bg-orange-950 border-orange-500">Astronomic Data</span>
          </h2>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span>STAR CORE LVL {starLevel}</span>
                <span className="text-[#ea580c]">{totalScrapInfused} INFUSED</span>
              </div>
              <div className="vu-meter h-2">
                <motion.div 
                  className="vu-value-orange h-full bg-orange-600 shadow-[0_0_8px_orange]"
                  animate={{ width: `${growthProgress}%` }}
                />
              </div>
            </div>
            
            <div className="flex flex-col gap-2 items-center">
              <div className="text-[10px] uppercase opacity-50 self-start">Local Nav Map [Tactical]</div>
              <div className="w-[200px] h-[200px] rusted-frame relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 grid-bg opacity-10" />
                
                {/* Home Star */}
                <motion.div 
                  className="absolute w-6 h-6 bg-orange-600 rounded-full blur-[1px] shadow-[0_0_15px_orange]"
                  animate={{ left: `${homeMap.x}%`, top: `${homeMap.y}%` }}
                />
                {/* Enemy Star */}
                <motion.div 
                  className="absolute w-10 h-10 bg-black rounded-full blur-[1px] border-2 border-red-500 shadow-[0_0_25px_red]"
                  animate={{ left: `${enemyMap.x}%`, top: `${enemyMap.y}%` }}
                />
                
                {/* Scrap Pulses */}
                {scrapList.slice(0, 30).map((s, i) => {
                  const mPos = getMapPos(s.pos);
                  if (mPos.x < -10 || mPos.x > 110 || mPos.y < -10 || mPos.y > 110) return null;
                  return (
                    <div 
                      key={i} 
                      className="absolute w-2 h-2 bg-pink-500/60 rounded-full animate-pulse"
                      style={{ left: `${mPos.x}%`, top: `${mPos.y}%` }}
                    />
                  );
                })}

                {/* Grid Overlay for depth */}
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)] border-2 border-white/5" />
                
                {/* Ship (Static center) */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-[#33ff33] shadow-[0_0_12px_#33ff33] z-20 border border-white/40 rounded-sm" />
                
                {/* NAV-COM Label (Overlay) */}
                <div className="nav-com-label pointer-events-none">NAV-COM v2.1</div>
              </div>
            </div>
          </div>
        </div>

        <div className="hud-panel p-4 flex-grow border-4 overflow-hidden relative">
          <h2 className="mb-4 pb-1 font-bold">
            <span className="embossed-label bg-zinc-900 border-zinc-700">Comms / Logs</span>
          </h2>
          <div className="text-[11px] leading-relaxed space-y-2 opacity-80 font-mono">
            {velocity > 4 && <p className="text-red-500">[WARN] SPEED EXCEEDS BUFFER</p>}
            {carrying > 15 && <p className="text-yellow-500">[WARN] CARGO OVERLOAD</p>}
            {carrying > 0 && <p className="text-pink-500 font-bold">[INFO] SCRAP LOAD: {carrying}U</p>}
            <p className="text-cyan-400 font-bold bg-cyan-950/40 px-1 border-l-2 border-cyan-500">[BANK] {teamScrap} CREDITS</p>
            {fuel < 20 && <p className="text-red-600 animate-pulse font-bold">[ERR] FUEL DEPLETED</p>}
            {glitch && <p className="text-yellow-600">[DATA] SENSORS RECALIBRATING...</p>}
            <p className="opacity-30">PINGS: {Math.floor(Math.random()*100)}ms</p>
            <p className="animate-pulse">_</p>
          </div>
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/60 to-transparent" />
          
          {/* Author's Signature Integrated */}
          <div className="absolute bottom-2 right-2 pitted-metal border border-zinc-800 animate-flicker pointer-events-none px-1.5 py-0.5 z-10 shadow-lg">
            <div className="font-mono text-[7px] leading-tight led-text-dim whitespace-nowrap font-bold">
              SCAV-TECH BY ADAM BAILEY // MOD-70.26
            </div>
          </div>
        </div>
      </aside>

      {/* Main Center Area */}
      <main className="flex-grow flex flex-col gap-4 relative">
        <div className="flex-grow pointer-events-none" />
        
        <div className="h-44 hud-panel flex p-4 gap-4 border-4 overflow-hidden">
          {/* Gauges Section */}
          <div className="flex items-center gap-4 w-1/4 min-w-[180px]">
            {useAnalogGauges ? (
              <>
                <NeedleGauge value={velocity} max={5} label="Inertia" color="#33ff33" />
                <NeedleGauge value={fuel} max={maxFuel} label="Fuel" color="#06b6d4" />
              </>
            ) : (
              <div className="flex flex-col gap-4 w-full">
                <div>
                  <div className="embossed-label mb-1 bg-zinc-800 border-zinc-600">Engine Load</div>
                  <div className="vu-meter h-4">
                    <motion.div 
                      className={`h-full ${velocity > 4 ? 'bg-red-600' : 'bg-[#33ff33] shadow-[0_0_8px_#33ff33]'}`}
                      animate={{ width: `${(velocity / 5) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="embossed-label mb-1 bg-cyan-950 border-cyan-500">Fuel Reserves</div>
                  <div className="vu-meter h-4">
                    <motion.div 
                      className="h-full bg-cyan-600 shadow-[0_0_8px_cyan]"
                      animate={{ width: `${(fuel / maxFuel) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="w-px bg-[#2d2d30] shrink-0"></div>

          <div className="flex-grow flex flex-col justify-between min-w-0">
            <div className="embossed-label mb-2 bg-[#1a1a1c] border-zinc-700">Ship Enhancements [Keys 1-4 | G for Gauges]</div>
            <div className="flex gap-2 pointer-events-auto overflow-x-auto pb-1 scrollbar-hide">
              {[
                { type: 'thrust' as const, label: 'Thrust', cost: 15, lvl: upgrades.thrust, key: '1' },
                { type: 'handling' as const, label: 'Nav', cost: 20, lvl: upgrades.handling, key: '2' },
                { type: 'attractor' as const, label: 'VAC', cost: 12, lvl: upgrades.attractor, key: '3' },
                { type: 'fuel' as const, label: 'Fuel', cost: 10, lvl: upgrades.fuelCap, key: '4' }
              ].map(u => (
                <button 
                  key={u.type}
                  onClick={() => onUpgrade(u.type)}
                  className="pitted-metal w-16 min-w-[64px] flex flex-col items-center py-2 relative group text-[#33ff33]"
                >
                  <span className="text-[9px] font-bold uppercase tracking-tighter">[{u.key}] {u.label.substring(0,4)}</span>
                  <span className="text-[8px] opacity-60">Lvl {u.lvl}</span>
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 transition-all opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] bg-black border border-zinc-800 p-1 font-mono">
                    REQ: {u.cost} SCRAP
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="w-px bg-[#2d2d30] shrink-0"></div>
          
          <div className="w-40 flex flex-col justify-between shrink-0">
            <div className="embossed-label bg-pink-900/80 border-pink-500 text-[9px]">Cargo Manifest</div>
            <div className="grid grid-cols-5 gap-0.5 h-20 py-1">
              {Array.from({ length: 15 }).map((_, i) => (
                <div 
                  key={i} 
                  className={`border border-[#2d2d30] ${i < carrying ? 'bg-pink-600 shadow-[0_0_8px_pink]' : 'bg-black/40'}`}
                />
              ))}
            </div>
            {carrying > 15 && <div className="text-[8px] text-pink-500 animate-pulse font-bold">WARNING: +{carrying-15} OVERLOAD</div>}
          </div>
        </div>
      </main>

      {/* Right Aside */}
      <aside className="w-24 flex flex-col gap-4">
        <div className="flex-grow hud-panel flex flex-col items-center py-6 gap-8 border-4">
          <div className="w-12 h-12 pitted-metal flex items-center justify-center text-red-600 text-[10px] text-center font-bold border-2 border-red-900 bg-red-950/20">JETTISON [SPACE]</div>
          <div className="w-12 h-12 pitted-metal flex items-center justify-center text-[#33ff33] text-[9px] text-center uppercase tracking-tighter">Attractor [Q/E/R]</div>
          <div className="w-12 h-12 pitted-metal flex items-center justify-center text-cyan-500 text-[10px] text-center shadow-[0_0_10px_rgba(6,182,212,0.2)]">FUEL OK</div>
          <button 
            onClick={() => setShowSysCfg(true)}
            className="w-12 h-12 pitted-metal flex items-center justify-center text-[#33ff33] hover:text-white hover:bg-zinc-800 transition-colors text-[10px] text-center pointer-events-auto"
          >
            SYSCFG
          </button>
        </div>
        <div className="h-32 hud-panel p-2 flex flex-col items-center justify-center border-4">
          <div className="text-[8px] text-[#444] mb-2 uppercase">Serial: 88-X9-R</div>
          <div className="w-full h-8 bg-zinc-950 border border-zinc-900 shadow-inner"></div>
          <div className="mt-2 text-[10px] opacity-20">BUILD: v2.4.0</div>
        </div>
      </aside>

      {/* SYSCFG Popup */}
      {showSysCfg && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md pointer-events-auto">
          <div className="w-full max-w-md rusted-frame p-8 border-4 relative overflow-hidden shadow-[0_0_100px_rgba(0,0,0,1)]">
            <div className="relative z-10">
              <div className="flex justify-between items-center mb-6 border-b-2 border-amber-900/40 pb-2">
                <div className="flex flex-col">
                  <h2 className="font-bold text-amber-600 uppercase tracking-widest text-sm leading-none">System Configuration</h2>
                  <span className="text-[10px] text-zinc-500 font-mono mt-1">SCAV-OS VERSION 70.26 [STABLE]</span>
                </div>
                <button 
                  onClick={() => setShowSysCfg(false)}
                  className="text-red-900 hover:text-red-500 text-xs font-mono transition-colors"
                >
                  [X] ABORT
                </button>
              </div>
              
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">ENGINE_MODEL:</span>
                  <span className="text-zinc-300">VITE-V5.4_CORTEX</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">PHYSICS_ENGINE:</span>
                  <span className="text-zinc-300">G-CONST_PHY_MOD</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">UI_RENDERER:</span>
                  <span className="text-zinc-300">REACT_HUD_SCAV</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">SHIP_SYSTEMS:</span>
                  <span className="text-[#33ff33]">MOD-CR90_ACTIVE</span>
                </div>
              </div>

              {/* Identity Plate Overlay */}
              <div className="mt-8 pt-6 border-t-2 border-zinc-900/60 flex flex-col items-center gap-2">
                <div className="pitted-metal px-6 py-2 border border-zinc-800 animate-flicker shadow-2xl relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                  <div className="font-mono text-[9px] leading-tight text-amber-600/70 text-center tracking-widest font-bold">
                    DESIGNED BY: <span className="text-amber-500">ADAM BAILEY</span>
                  </div>
                  <div className="font-mono text-[8px] text-[#33ff33]/40 text-center uppercase mt-0.5 tracking-tighter">
                    SCAV-TECH CUSTOM MODIFICATION // R-70.26
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-center">
                <button 
                  onClick={() => setShowSysCfg(false)}
                  className="pitted-metal px-12 py-3 text-xs font-bold hover:bg-zinc-800 transition-all uppercase tracking-widest text-amber-500 border border-amber-900/30 hover:border-amber-500 shadow-lg"
                >
                  Confirm Diagnostics
                </button>
              </div>
              
              <div className="mt-8 text-center text-[9px] opacity-30 italic font-serif text-amber-100 flex items-center justify-center gap-2">
                <span className="w-8 h-px bg-white/10" />
                "One man's trash is another man's propulsion system"
                <span className="w-8 h-px bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
