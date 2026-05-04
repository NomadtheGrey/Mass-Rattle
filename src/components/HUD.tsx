import { motion } from 'motion/react';
import React from 'react';

interface NeedleGaugeProps {
  value: number;
  max: number;
  label: string;
  color: string;
  isFuel?: boolean;
}

const NeedleGauge: React.FC<NeedleGaugeProps> = ({ value, max, label, color, isFuel }) => {
  const percent = Math.min(value / max, 1.2);
  const rotation = (percent * 180) - 90; 
  const jitter = (Math.random() - 0.5) * 1.5;

  const isLow = isFuel && percent < 0.3;
  const isCritical = isFuel && percent < 0.1;

  // Velocity gauge background should be transparent as requested
  const isVelocity = label.includes('VELOCITY');

  return (
    <div className="flex flex-col items-center">
      <div className={`relative w-24 h-12 overflow-hidden border-b-2 border-zinc-800 transition-colors duration-500 ${
        isCritical ? 'bg-red-600/40 animate-pulse shadow-[inset_0_0_20px_#ef4444]' : 
        isLow ? 'bg-orange-800/20' : 
        isVelocity ? 'bg-transparent' : 'bg-zinc-900/10'
      }`}>
        <div className="absolute bottom-0 left-0 w-full h-24 border-8 border-t-zinc-800 border-l-zinc-800 border-r-zinc-800 rounded-full opacity-20" />
        <motion.div 
          className="absolute bottom-0 left-1/2 w-0.5 h-14 origin-bottom -translate-x-1/2"
          style={{ backgroundColor: isCritical ? '#ef4444' : color, rotate: rotation + jitter }}
          transition={{ type: 'spring', damping: 12, stiffness: 90 }}
        />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#0a0a0c] border border-zinc-700 z-10" />
      </div>
      <div className={`embossed-label mt-2 transition-colors ${
        isCritical ? 'bg-red-600 border-red-400 text-white' : isLow ? 'bg-orange-700 border-orange-500 text-white' : 'bg-[#222] border-[#444]'
      }`}>
        {label}
      </div>
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
  shipHealth: number;
  maxShipHealth: number;
  enemyIntegrity: number;
  isShopOpen: boolean;
  useAnalogGauges: boolean;
  shipPos: { x: number; y: number };
  starPos: { x: number; y: number };
  enemyStarPos: { x: number; y: number };
  scrapList: { pos: { x: number; y: number } }[];
  upgrades: { thrust: number; handling: number; attractor: number; fuelCap: number };
  slip: number;
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
  shipHealth,
  maxShipHealth,
  enemyIntegrity,
  isShopOpen,
  useAnalogGauges,
  shipPos,
  starPos,
  enemyStarPos,
  scrapList,
  upgrades,
  slip,
  onUpgrade
}) => {
  const growthProgress = (totalScrapInfused % 100);
  const starLevel = Math.floor(totalScrapInfused / 100) + 1;
  const [showSysCfg, setShowSysCfg] = React.useState(false);

  // Minimap logic
  const mapScale = 0.025;
  const mapCenter = { x: 50, y: 50 };

  const getMapPos = (pos: { x: number; y: number }) => {
    // Ship is always at 50,50. We calculate relative offset scaled by mapScale.
    const rawX = 50 + (pos.x - shipPos.x) * mapScale;
    const rawY = 50 + (pos.y - shipPos.y) * mapScale;
    return { x: rawX, y: rawY };
  };

  const getEdgeIndicator = (mPos: { x: number; y: number }) => {
    const dx = mPos.x - 50;
    const dy = mPos.y - 50;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Check if outside circular radius (48% instead of 50% for padding)
    if (dist < 48) return null;

    const angle = Math.atan2(dy, dx);
    return {
      x: 50 + Math.cos(angle) * 46, 
      y: 50 + Math.sin(angle) * 46,
      angle: (angle * 180 / Math.PI) + 90
    };
  };

  const homeMap = getMapPos(starPos);
  const homeIndicator = getEdgeIndicator(homeMap);
  const enemyMap = getMapPos(enemyStarPos);
  const enemyIndicator = getEdgeIndicator(enemyMap);

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
                <span>HOME STAR GROWTH</span>
                <span className="text-[#ea580c]">{totalScrapInfused} INFUSED</span>
              </div>
              <div className="vu-meter h-2 bg-orange-950/20">
                <motion.div 
                  className="h-full bg-gradient-to-r from-orange-800 to-orange-400 shadow-[0_0_8px_orange]"
                  animate={{ width: `${growthProgress}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-red-500">ENEMY STAR COLLAPSE</span>
                <span className="text-red-500">{Math.floor(enemyIntegrity * 100)}%</span>
              </div>
              <div className="vu-meter h-2 bg-red-950/20">
                <motion.div 
                  className="h-full bg-red-600 shadow-[0_0_8px_#ef4444]"
                  animate={{ width: `${enemyIntegrity * 100}%` }}
                />
              </div>
            </div>
            
            <div className="flex flex-col gap-2 items-center">
              <div className="text-[10px] uppercase opacity-50 self-start">Local Nav Map [Tactical]</div>
              <div className="w-[200px] h-[200px] rusted-frame relative overflow-hidden shadow-2xl">
                <div className="absolute inset-0 grid-bg opacity-10" />
                
                {/* Home Star */}
                {!homeIndicator ? (
                  <motion.div 
                    className="absolute w-6 h-6 bg-orange-600 rounded-full blur-[1px] shadow-[0_0_15px_orange] z-10"
                    animate={{ left: `${homeMap.x}%`, top: `${homeMap.y}%` }}
                    style={{ x: '-50%', y: '-50%' }}
                  />
                ) : (
                  <div 
                    className="absolute w-3 h-3 text-orange-500 z-10"
                    style={{ left: `${homeIndicator.x}%`, top: `${homeIndicator.y}%`, transform: `translate(-50%, -50%) rotate(${homeIndicator.angle}deg)` }}
                  >
                    <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-orange-600 shadow-[0_0_10px_orange]" />
                  </div>
                )}

                {/* Enemy Star */}
                {!enemyIndicator ? (
                  <motion.div 
                    className="absolute w-10 h-10 bg-black rounded-full blur-[1px] border-2 border-red-500 shadow-[0_0_25px_red] z-10"
                    animate={{ left: `${enemyMap.x}%`, top: `${enemyMap.y}%` }}
                    style={{ x: '-50%', y: '-50%' }}
                  />
                ) : (
                  <div 
                    className="absolute w-4 h-4 text-red-500 z-10"
                    style={{ left: `${enemyIndicator.x}%`, top: `${enemyIndicator.y}%`, transform: `translate(-50%, -50%) rotate(${enemyIndicator.angle}deg)` }}
                  >
                    <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[10px] border-b-red-600 shadow-[0_0_15px_red] animate-pulse" />
                  </div>
                )}
                
                {/* Scrap Pulses and Indicators */}
                {scrapList.map((s, i) => {
                  const mPos = getMapPos(s.pos);
                  const dx = mPos.x - 50;
                  const dy = mPos.y - 50;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  const isOutOfRange = dist > 48;
                  
                  if (!isOutOfRange) {
                    return (
                      <div 
                        key={i} 
                        className="absolute w-0.5 h-0.5 bg-pink-400 rounded-full animate-pulse shadow-[0_0_2px_pink] z-10"
                        style={{ left: `${mPos.x}%`, top: `${mPos.y}%`, transform: 'translate(-50%, -50%)' }}
                      />
                    );
                  }

                  // Direction indicators for "nearby" scrap (within 2x range)
                  if (dist < 100) {
                    const ind = getEdgeIndicator(mPos);
                    if (ind) {
                      return (
                        <div 
                          key={`ind-${i}`} 
                          className="absolute w-1 h-1 bg-pink-600/60 rounded-full z-10 shadow-[0_0_2px_pink]"
                          style={{ left: `${ind.x}%`, top: `${ind.y}%`, transform: 'translate(-50%, -50%)' }}
                        />
                      );
                    }
                  }
                  return null;
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
              <div className="mb-4">
                <div className="flex justify-between text-[9px] mb-1">
                  <span className={shipHealth < 30 ? 'text-red-500 animate-pulse' : 'text-zinc-400'}>HULL_INTEGRITY</span>
                  <span>{Math.floor(shipHealth)}%</span>
                </div>
                <div className="vu-meter h-3 bg-zinc-900 border border-zinc-800">
                  <motion.div 
                    className={`h-full ${shipHealth < 30 ? 'bg-red-600' : 'bg-cyan-600 shadow-[0_0_8px_cyan]'}`}
                    animate={{ width: `${shipHealth}%` }}
                  />
                </div>
              </div>
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
          <div className="flex items-center justify-center w-1/4 min-w-[220px]">
            {useAnalogGauges ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <NeedleGauge value={velocity} max={7.5} label="V-VELOCITY" color="#33ff33" />
                <NeedleGauge value={fuel} max={maxFuel} label="FUEL" color="#06b6d4" isFuel={true} />
                <NeedleGauge value={slip * 10} max={10} label="I-SLIP" color={slip > 0.5 ? "#f97316" : "#33ff33"} />
                <NeedleGauge value={carrying} max={50} label="C-MASS" color={carrying > 25 ? "#f97316" : "#06b6d4"} />
              </div>
            ) : (
              <div className="flex flex-col gap-2 w-full text-[9px]">
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span className="opacity-60">VELOCITY</span>
                    <span className={velocity > 6 ? 'text-red-500' : ''}>{velocity.toFixed(1)}</span>
                  </div>
                  <div className="vu-meter h-2">
                    <motion.div 
                      className={`h-full ${velocity > 6 ? 'bg-red-600' : 'bg-[#33ff33] shadow-[0_0_4px_#33ff33]'}`}
                      animate={{ width: `${(velocity / 7.5) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span className="opacity-60 text-pink-400">CARGO LOAD</span>
                    <span>{carrying}U</span>
                  </div>
                  <div className="vu-meter h-2 bg-pink-900/20">
                    <motion.div 
                      className="h-full bg-pink-500 shadow-[0_0_4px_pink]"
                      animate={{ width: `${Math.min((carrying / 50) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-0.5">
                    <span className="opacity-60 text-orange-400">INERTIA SLIP</span>
                    <span>{(slip * 100).toFixed(0)}%</span>
                  </div>
                  <div className="vu-meter h-2 bg-orange-900/20">
                    <motion.div 
                      className={`h-full ${slip > 0.5 ? 'bg-orange-500' : 'bg-zinc-600'}`}
                      animate={{ width: `${slip * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className={`flex justify-between mb-0.5 ${
                    fuel < maxFuel * 0.1 ? 'text-red-500 animate-pulse' : ''
                  }`}>
                    <span>ENERGY</span>
                    <span>{Math.floor(fuel)}</span>
                  </div>
                  <div className="vu-meter h-2">
                    <motion.div 
                      className={`h-full transition-colors ${
                        fuel < maxFuel * 0.1 ? 'bg-red-500' : 
                        fuel < maxFuel * 0.3 ? 'bg-orange-500' : 
                        'bg-cyan-600'
                      }`}
                      animate={{ width: `${(fuel / maxFuel) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="w-px bg-[#2d2d30] shrink-0"></div>

          <div className="flex-grow flex flex-col justify-between min-w-0">
            <div className="embossed-label mb-2 bg-[#1a1a1c] border-zinc-700">Ship Enhancements [Keys 1-5 | G for Gauges]</div>
            <div className="flex gap-2 pointer-events-auto overflow-x-auto pb-1 scrollbar-hide">
              {[
                { type: 'thrust' as const, label: 'Thrust', cost: 15, lvl: upgrades.thrust, key: '1' },
                { type: 'handling' as const, label: 'Nav', cost: 20, lvl: upgrades.handling, key: '2' },
                { type: 'attractor' as const, label: 'VAC', cost: 12, lvl: upgrades.attractor, key: '3' },
                { type: 'fuel' as const, label: 'Fuel', cost: 10, lvl: upgrades.fuelCap, key: '4' },
                { type: 'cargo' as const, label: 'Cargo', cost: 25, lvl: upgrades.cargo, key: '5' }
              ].map(u => (
                <button 
                  key={u.type}
                  onClick={() => onUpgrade(u.type)}
                  disabled={carrying < u.cost}
                  className={`pitted-metal w-16 min-w-[64px] flex flex-col items-center py-2 relative group transition-all ${
                    carrying >= u.cost ? 'text-[#33ff33] opacity-100' : 'text-zinc-600 opacity-50 grayscale cursor-not-allowed'
                  }`}
                >
                  <span className="text-[9px] font-bold uppercase tracking-tighter">[{u.key}] {u.label.substring(0,4)}</span>
                  <span className="text-[8px] opacity-60">Lvl {u.lvl}</span>
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 transition-all opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] bg-black border border-zinc-800 p-1 font-mono z-50">
                    REQ: {u.cost} CARGO
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="w-px bg-[#2d2d30] shrink-0"></div>
          
          <div className="w-40 flex flex-col justify-between shrink-0">
            <div className="embossed-label bg-pink-900/80 border-pink-500 text-[9px]">Cargo Manifest</div>
            <div className="grid grid-cols-5 gap-0.5 h-20 py-1">
              {(() => {
                const regularCap = 20 + upgrades.cargo * 10;
                const overloadCap = Math.floor(regularCap * 0.25);
                const totalSlots = regularCap + overloadCap;
                
                return Array.from({ length: totalSlots }).map((_, i) => {
                  const isOverload = i >= regularCap;
                  const isFilled = i < carrying;
                  
                  return (
                    <div 
                      key={i} 
                      className={`border ${
                        isOverload ? 'border-amber-900/40' : 'border-[#2d2d30]'
                      } ${
                        isFilled 
                          ? isOverload 
                            ? 'bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]' 
                            : 'bg-pink-600 shadow-[0_0_4px_pink]' 
                          : 'bg-black/40'
                      }`}
                    />
                  );
                });
              })()}
            </div>
            {carrying > (20 + (upgrades as any).cargo * 10) && (
              <div className="text-[8px] text-amber-500 animate-pulse font-bold uppercase tracking-tighter leading-none mt-1">
                Hull Overload: Slow-Down Active
              </div>
            )}
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

      {/* Mobile Workshop Overlay */}
      {isShopOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-xl hud-panel p-8 border-4 relative overflow-hidden bg-zinc-950/80 shadow-[0_0_50px_rgba(51,255,51,0.1)]"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#33ff33]/5 to-transparent pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex justify-between items-center mb-8 border-b-2 border-zinc-800 pb-4">
                <div className="flex flex-col">
                  <h2 className="font-bold text-[#33ff33] uppercase tracking-widest text-lg leading-none">Nomadic Workshop</h2>
                  <span className="text-[10px] text-zinc-500 font-mono mt-1">MOBILE REPAIR & ENHANCEMENT UNIT // READY</span>
                </div>
                <div className="text-right">
                  <div className="text-pink-500 text-xs font-mono">AVAILABLE CARGO</div>
                  <div className="text-xl font-bold text-pink-400 leading-none">{carrying}U</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { type: 'thrust' as const, label: 'Thrust Vectoring', desc: 'Increases engine output & acceleration', cost: 15, lvl: upgrades.thrust, icon: '🚀' },
                  { type: 'handling' as const, label: 'Neural Nav-Link', desc: 'Improves rotation speed & response', cost: 20, lvl: upgrades.handling, icon: '🕹️' },
                  { type: 'attractor' as const, label: 'High-Gauss VAC', desc: 'Expands scrap collection radius', cost: 12, lvl: upgrades.attractor, icon: '🧲' },
                  { type: 'fuel' as const, label: 'Plasma Reserves', desc: 'Increases total fuel capacity', cost: 10, lvl: upgrades.fuelCap, icon: '⚡' },
                  { type: 'cargo' as const, label: 'Hull Expansion', desc: 'Increases max cargo hold capacity', cost: 25, lvl: upgrades.cargo, icon: '📦' }
                ].map(u => (
                  <button 
                    key={u.type}
                    onClick={() => onUpgrade(u.type)}
                    disabled={carrying < u.cost}
                    className={`pitted-metal p-4 flex flex-col gap-2 relative transition-all text-left ${
                      carrying >= u.cost ? 'hover:bg-zinc-900 border-zinc-700' : 'opacity-40 border-zinc-800 grayscale cursor-not-allowed'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-bold uppercase text-[#33ff33]">{u.label}</span>
                      <span className="text-xs opacity-60">LVL {u.lvl}</span>
                    </div>
                    <p className="text-[10px] opacity-60 leading-tight h-8">{u.desc}</p>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-zinc-800/50">
                      <span className="text-[10px] font-mono text-pink-500 font-bold">COST: {u.cost}U</span>
                      <span className="bg-zinc-800 px-2 py-0.5 rounded text-[9px] text-[#33ff33]">Purchase</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-zinc-800 flex justify-between items-center text-[10px] font-mono opacity-50">
                <span>[TAB/U] CLOSE WORKSHOP</span>
                <span className="animate-pulse">_SCAV_OS_MOD_ACTIVE</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}

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
