import { motion } from 'motion/react';
import React from 'react';
import { PHYSICS } from '../constants';
import { milestonesForInfused, progressIntoNextMilestone, nextMilestoneCost } from '../starGrowth';
import { LOADOUT_ITEMS, getLoadoutItem, itemTierCost, swapCostForTier, MAX_ITEM_TIER, ArsenalCategory, shieldMaxFor } from '../loadout';

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
  upgrades: { thrust: number; handling: number; attractor: number; fuelCap: number; cargo: number };
  slip: number;
  onUpgrade: (type: 'thrust' | 'handling' | 'attractor' | 'fuel' | 'cargo') => void;
  // Arsenal (weapons / defenses / hybrids): owned tiers + equipped loadout.
  arsenal: Record<string, number>;
  loadout: { weapon: string | null; defense: string | null; hybrid: string | null };
  onBuyItem: (itemId: string) => void;
  onEquipItem: (itemId: string) => void;
  // The Bank: saved scrap balance + hold<->bank transfers.
  bankedScrap: number;
  bankInWell: boolean;
  shopRefusedAt?: number;
  shieldHp?: number;
  decoyActive?: boolean;
  cmeWarning?: boolean;
  onDeployDecoy?: () => void;
  onFeedCargo: () => void;
  onDepositBank: () => void;
  onWithdrawBank: () => void;
  isMobileRadarOpen?: boolean;
  onToggleMobileRadar?: () => void;
  onCloseShop?: () => void;
  onOpenShop?: () => void;
  onToggleGauges?: () => void;
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
  onUpgrade,
  arsenal,
  loadout,
  onBuyItem,
  onEquipItem,
  bankedScrap,
  bankInWell,
  shopRefusedAt,
  shieldHp,
  decoyActive,
  cmeWarning,
  onDeployDecoy,
  onFeedCargo,
  onDepositBank,
  onWithdrawBank,
  isMobileRadarOpen = false,
  onToggleMobileRadar,
  onCloseShop,
  onOpenShop,
  onToggleGauges
}) => {
  // COMBINED WALLET: shop affordability is judged on hold + bank together,
  // matching walletPay in the game loop — but the bank is the home star's
  // gravity well, so banked savings only count while inside it.
  const funds = carrying + (bankInWell ? bankedScrap : 0);
  // Star growth readouts follow the RISING milestone costs (starGrowth.ts):
  // progress is scrap into the CURRENT milestone, judged against that
  // milestone's own cost — e.g. 40/125 while working on M2, not x/100.
  const growthProgress = progressIntoNextMilestone(totalScrapInfused);
  const growthCost = nextMilestoneCost(totalScrapInfused);
  const starLevel = milestonesForInfused(totalScrapInfused) + 1;
  const [showSysCfg, setShowSysCfg] = React.useState(false);
  // Workshop tabs: the five base ship tracks, then the Arsenal categories.
  const [shopTab, setShopTab] = React.useState<'ship' | 'bank' | ArsenalCategory>('ship');
  const [localRadarOpen, setLocalRadarOpen] = React.useState(false);

  const radarActive = isMobileRadarOpen || localRadarOpen;

  // CONTROLS CARD rows (desktop, bottom-left of the play area): the whole
  // key set in one readable place. Contextual like the rest of the HUD —
  // FIRE wears the equipped weapon, the DECOY row exists only while a
  // beacon is equipped, SHOP carries its well rule with it.
  const controlsWeapon = getLoadoutItem(loadout.weapon);
  const controlRows: { label: string; keys: string; dim?: boolean }[] = [
    { label: 'THRUST', keys: 'W · ↑' },
    { label: 'STEER', keys: 'A D · ← →' },
    { label: 'VAC · HOLD', keys: 'Q E R' },
    controlsWeapon
      ? { label: 'FIRE · HOLD', keys: `F — ${controlsWeapon.name.toUpperCase()}` }
      : { label: 'FIRE · HOLD', keys: 'F — NO WEAPON', dim: true },
    { label: 'EJECT PULSE', keys: 'SPACE' },
    ...(loadout.defense === 'decoy_beacon'
      ? [{ label: 'DEPLOY DECOY', keys: 'X' } as { label: string; keys: string; dim?: boolean }]
      : []),
    { label: 'SHOP', keys: 'TAB · U — AT HOME STAR' },
    { label: 'UPGRADES', keys: '1 – 5' },
  ];

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

  const renderRadarView = (sizeClass = "w-[200px] h-[200px]") => (
    <div className={`${sizeClass} rusted-frame relative overflow-hidden shadow-2xl touch-none`}>
      <div className="absolute inset-0 grid-bg opacity-15" />
      
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
              className="absolute w-1 h-1 bg-pink-400 rounded-full animate-pulse shadow-[0_0_2px_pink] z-10"
              style={{ left: `${mPos.x}%`, top: `${mPos.y}%`, transform: 'translate(-50%, -50%)' }}
            />
          );
        }

        if (dist < 120) {
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
      
      {/* NAV-COM Label */}
      <div className="nav-com-label pointer-events-none">NAV-COM v2.1</div>
    </div>
  );

  return (
    <div className={`fixed inset-0 pointer-events-none z-50 flex flex-col md:flex-row p-2 sm:p-4 md:p-6 gap-2 md:gap-4 ${glitch ? 'animate-pulse' : ''} text-[#33ff33]`}>
      
      {/* MOBILE TOP STATUS RIBBON (Cellphones: iPhone & Android) */}
      <header className="flex md:hidden w-full flex-col gap-1 pointer-events-auto bg-zinc-950/85 backdrop-blur-md p-2 rounded border-2 border-zinc-800 shadow-xl select-none">
        {/* Top Row: Stars & Bank */}
        <div className="flex items-center justify-between text-[9px] font-mono leading-none">
          <div className="flex items-center gap-2">
            <span className="text-orange-500 font-bold">HOME: {totalScrapInfused}U</span>
            <span className="text-zinc-600">|</span>
            <span className="text-red-500 font-bold">ENEMY: {Math.floor(enemyIntegrity * 100)}%</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-cyan-400 font-bold bg-cyan-950/60 px-1 py-0.5 rounded border border-cyan-800">
              FED: {teamScrap}U
            </span>
            <button
              onClick={() => setShowSysCfg(true)}
              className="text-zinc-400 hover:text-white px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[8px]"
            >
              SYS
            </button>
          </div>
        </div>

        {/* Meters Row */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          {/* Hull Integrity */}
          <div>
            <div className="flex justify-between text-[8px] mb-0.5">
              <span className={shipHealth < 30 ? 'text-red-500 animate-pulse font-bold' : 'text-zinc-400'}>
                HULL {Math.floor(shipHealth)}%
              </span>
              <span className="text-pink-400 font-bold">
                CARGO {carrying}/{PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS}
              </span>
            </div>
            <div className="vu-meter h-2 bg-zinc-900 border border-zinc-800">
              <motion.div 
                className={`h-full ${shipHealth < 30 ? 'bg-red-600' : 'bg-cyan-500 shadow-[0_0_6px_cyan]'}`}
                animate={{ width: `${shipHealth}%` }}
              />
            </div>
          </div>

          {/* Fuel / Energy & Star Collapse */}
          <div>
            <div className="flex justify-between text-[8px] mb-0.5">
              <span className={fuel < maxFuel * 0.2 ? 'text-red-500 animate-pulse' : 'text-cyan-300'}>
                FUEL {Math.floor(fuel)}/{maxFuel}
              </span>
              <span className="text-orange-400">STAR LVL {starLevel}</span>
            </div>
            <div className="vu-meter h-2 bg-zinc-900 border border-zinc-800">
              <motion.div 
                className={`h-full transition-colors ${
                  fuel < maxFuel * 0.15 ? 'bg-red-500' : 
                  fuel < maxFuel * 0.35 ? 'bg-orange-500' : 
                  'bg-emerald-500 shadow-[0_0_6px_#10b981]'
                }`}
                animate={{ width: `${(fuel / maxFuel) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* MOBILE RADAR MODAL / POPOVER */}
      {radarActive && (
        <div className="md:hidden fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm pointer-events-auto">
          <div className="hud-panel p-4 border-4 rounded-xl flex flex-col items-center gap-3 bg-zinc-950 shadow-2xl">
            <div className="flex justify-between items-center w-full border-b border-zinc-800 pb-2">
              <span className="text-xs font-mono font-bold text-orange-400 uppercase tracking-widest">TACTICAL RADAR</span>
              <button 
                onClick={() => {
                  if (onToggleMobileRadar) onToggleMobileRadar();
                  setLocalRadarOpen(false);
                }}
                className="text-red-500 hover:text-white text-xs font-mono px-2 py-0.5 bg-zinc-900 border border-red-900 rounded"
              >
                [X] CLOSE
              </button>
            </div>
            {renderRadarView("w-64 h-64")}
            <div className="text-[9px] font-mono text-zinc-400 text-center">
              Orange: Home Core | Red: Enemy Core | Pink: Scrap Fields
            </div>
          </div>
        </div>
      )}

      {/* DESKTOP LEFT ASIDE (Hidden on phones) */}
      <aside className="hidden md:flex w-48 min-w-[192px] flex-col gap-4">
        <div className="hud-panel p-4 border-4">
          <div className="absolute top-0 right-0 p-1 text-[10px] text-[#2d2d30]">MOD-CR90</div>
          <h2 className="mb-4 pb-1 font-bold">
            <span className="embossed-label bg-orange-950 border-orange-500">Astronomic Data</span>
          </h2>
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span>HOME STAR GROWTH</span>
                <span className="text-[#ea580c]">{growthProgress}/{growthCost} · {totalScrapInfused} INFUSED</span>
              </div>
              <div className="vu-meter h-2 bg-orange-950/20">
                <motion.div 
                  className="h-full bg-gradient-to-r from-orange-800 to-orange-400 shadow-[0_0_8px_orange]"
                  animate={{ width: `${(growthProgress / growthCost) * 100}%` }}
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
              {renderRadarView()}
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
              {carrying > (PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS) && <p className="text-yellow-500">[WARN] CARGO OVERLOAD</p>}
              {carrying > 0 && <p className="text-pink-500 font-bold">[INFO] SCRAP LOAD: {carrying}U</p>}
              <p className="text-cyan-400 font-bold bg-cyan-950/40 px-1 border-l-2 border-cyan-500">[FED] {teamScrap}U DELIVERED</p>
              {fuel < 20 && <p className="text-red-600 animate-pulse font-bold">[ERR] FUEL DEPLETED</p>}
              {glitch && <p className="text-yellow-600">[DATA] SENSORS RECALIBRATING...</p>}
              <p className="opacity-30">PINGS: {Math.floor(Math.random()*100)}ms</p>
              <p className="animate-pulse">_</p>
            </div>
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/60 to-transparent" />
          
          {/* Author's Signature */}
          <div className="absolute bottom-2 right-2 pitted-metal border border-zinc-800 animate-flicker pointer-events-none px-1.5 py-0.5 z-10 shadow-lg">
            <div className="font-mono text-[7px] leading-tight led-text-dim whitespace-nowrap font-bold">
              SCAV-TECH BY ADAM BAILEY // MOD-70.26
            </div>
          </div>
        </div>
      </aside>

      {/* DESKTOP MAIN CENTER AREA */}
      <main className="hidden md:flex flex-grow flex-col gap-4 relative">
        <div className="flex-grow pointer-events-none relative">
          {/* CONTROLS CARD — bottom-left of the play area (desktop).
              Replaces the stale 20%-opacity help footer that lived in
              App.tsx and never learned FIRE [F] or DECOY [X]. */}
          <div className="absolute bottom-0 left-0 pointer-events-auto">
            <div className="hud-panel border-2 bg-zinc-950/90 shadow-2xl px-3 py-2 min-w-[176px]">
              <div className="text-[8px] font-mono font-bold tracking-[0.25em] text-zinc-500 mb-1.5">SHIP CONTROLS</div>
              <div className="flex flex-col gap-1">
                {controlRows.map(row => (
                  <div key={row.label} className={`flex justify-between gap-3 text-[9px] font-mono ${row.dim ? 'opacity-40' : ''}`}>
                    <span className="text-zinc-400 tracking-wider">{row.label}</span>
                    <span className="text-[#33ff33] font-bold whitespace-nowrap">{row.keys}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Utility Cluster */}
          <div className="absolute bottom-0 right-0 w-24 flex flex-col gap-2 items-end">
            <div className="hud-panel w-16 p-2 flex flex-col items-center gap-4 border-2 bg-zinc-950/90 shadow-2xl pointer-events-auto">
              <div className="w-10 h-10 pitted-metal flex items-center justify-center text-red-600 text-[8px] text-center font-bold border border-red-900 bg-red-950/20">JETTISON [SPACE]</div>
              <div className="w-10 h-10 pitted-metal flex items-center justify-center text-red-400 text-[8px] text-center font-bold border border-red-900 bg-red-950/20">FIRE [F]</div>
              <div className="w-10 h-10 pitted-metal flex items-center justify-center text-[#33ff33] text-[7px] text-center uppercase tracking-tighter">VAC [Q/E/R]</div>
              <div className="w-10 h-10 pitted-metal flex items-center justify-center text-cyan-500 text-[8px] text-center">FUEL OK</div>
              <button 
                onClick={() => setShowSysCfg(true)}
                className="w-10 h-10 pitted-metal flex items-center justify-center text-[#33ff33] hover:text-white hover:bg-zinc-800 transition-colors text-[8px] text-center pointer-events-auto cursor-pointer"
              >
                SYSCFG
              </button>
            </div>
            <div className="hud-panel w-20 p-2 border-2 bg-zinc-950/90 flex flex-col items-center justify-center gap-1">
              <div className="text-[7px] text-zinc-600 uppercase whitespace-nowrap">S/N: 88-X9-R</div>
              <div className="text-[8px] opacity-30">v2.4.0</div>
            </div>
          </div>
        </div>
        
        <div className="h-44 hud-panel flex p-4 gap-4 border-4 overflow-hidden">
          {/* Gauges Section */}
          <div className="flex items-center justify-center w-1/4 min-w-[200px]">
            {useAnalogGauges ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <NeedleGauge value={velocity} max={7.5} label="V-VELOCITY" color="#33ff33" />
                <NeedleGauge value={fuel} max={maxFuel} label="FUEL" color="#06b6d4" isFuel={true} />
                <NeedleGauge value={slip * 10} max={10} label="I-SLIP" color={slip > 0.5 ? "#f97316" : "#33ff33"} />
                <NeedleGauge 
                  value={carrying} 
                  max={PHYSICS.CARGO.BASE_CAPACITY + PHYSICS.CARGO.UPGRADE_BONUS * 5 * 1.25} 
                  label="C-MASS" 
                  color={carrying > (PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS) ? "#f97316" : "#06b6d4"} 
                />
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
                      animate={{ width: `${Math.min((carrying / (PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS * 1.25)) * 100, 100)}%` }}
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
                      className="h-full ${slip > 0.5 ? 'bg-orange-500' : 'bg-zinc-600'}"
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
                { type: 'thrust' as const, label: 'Thrust', base: PHYSICS.UPGRADE_COSTS.THRUST, lvl: upgrades.thrust, key: '1' },
                { type: 'handling' as const, label: 'Nav', base: PHYSICS.UPGRADE_COSTS.HANDLING, lvl: upgrades.handling, key: '2' },
                { type: 'attractor' as const, label: 'VAC', base: PHYSICS.UPGRADE_COSTS.ATTRACTOR, lvl: upgrades.attractor, key: '3' },
                { type: 'fuel' as const, label: 'Fuel', base: PHYSICS.UPGRADE_COSTS.FUEL, lvl: upgrades.fuelCap, key: '4' },
                { type: 'cargo' as const, label: 'Cargo', base: PHYSICS.UPGRADE_COSTS.CARGO, lvl: upgrades.cargo, key: '5' }
              ].map(u => {
                const cost = u.base + (u.lvl * Math.floor(u.base * 0.5));
                return (
                  <button 
                    key={u.type}
                    onClick={() => onUpgrade(u.type)}
                    disabled={funds < cost}
                    className={`pitted-metal w-16 min-w-[64px] flex flex-col items-center py-2 relative group transition-all ${
                      funds >= cost ? 'text-[#33ff33] opacity-100' : 'text-zinc-600 opacity-50 grayscale cursor-not-allowed'
                    }`}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-tighter">[{u.key}] {u.label.substring(0,4)}</span>
                    <span className="text-[8px] opacity-60">Lvl {u.lvl}</span>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 transition-all opacity-0 group-hover:opacity-100 whitespace-nowrap text-[10px] bg-black border border-zinc-800 p-1 font-mono z-50">
                      REQ: {cost} SCRAP (HOLD+BANK)
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="w-px bg-[#2d2d30] shrink-0"></div>
          
          <div className="w-48 flex flex-col justify-between shrink-0">
            <div className="flex justify-between items-center mb-1">
              <div className="embossed-label bg-pink-900/80 border-pink-500 text-[9px] py-0 px-1 whitespace-nowrap">Cargo Manifest</div>
              <div className="text-[10px] font-mono font-bold text-pink-400 ml-1">
                {(() => {
                  const reg = PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS;
                  const ovr = Math.floor(reg * PHYSICS.CARGO.OVERLOAD_RATIO);
                  if (carrying > reg) {
                    return `${reg}/${reg} [+${carrying - reg}/${ovr}]`;
                  }
                  return `${carrying}/${reg}`;
                })()}
              </div>
            </div>
            <div className="flex-grow flex items-center justify-center min-h-[80px] bg-black/40 rounded border border-zinc-900/50 my-1 overflow-hidden p-1.5 shadow-inner">
              {(() => {
                const regularCap = PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS;
                const overloadCap = Math.floor(regularCap * PHYSICS.CARGO.OVERLOAD_RATIO);
                const totalSlots = regularCap + overloadCap;
                
                const containerW = 170;
                const containerH = 75;
                const gap = 2;
                
                let bestSize = 4;
                let bestCols = 4;
                
                for (let c = 1; c <= totalSlots; c++) {
                  const r = Math.ceil(totalSlots / c);
                  const s = Math.min((containerW - (c - 1) * gap) / c, (containerH - (r - 1) * gap) / r);
                  if (s > bestSize) {
                    bestSize = s;
                    bestCols = c;
                  }
                }
                
                const finalSize = Math.min(bestSize, 20);

                return (
                  <div 
                    className="grid" 
                    style={{ 
                      gridTemplateColumns: `repeat(${bestCols}, ${finalSize}px)`,
                      gridAutoRows: `${finalSize}px`,
                      gap: `${gap}px`
                    }}
                  >
                    {Array.from({ length: totalSlots }).map((_, i) => {
                      const isOverload = i >= regularCap;
                      const isFilled = i < carrying;
                      
                      return (
                        <div 
                          key={i} 
                          className={`border ${
                            isOverload ? 'border-amber-900/60' : 'border-[#2d2d30]'
                          } ${
                            isFilled 
                              ? isOverload 
                                ? 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]' 
                                : 'bg-pink-600 shadow-[0_0_4px_pink]' 
                              : 'bg-black/40'
                          }`}
                          style={{ width: finalSize, height: finalSize }}
                        />
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            {carrying > (PHYSICS.CARGO.BASE_CAPACITY + upgrades.cargo * PHYSICS.CARGO.UPGRADE_BONUS) && (
              <div className="text-[8px] text-amber-500 animate-pulse font-bold uppercase tracking-tighter leading-none mt-1 text-center">
                WARNING: HULL INTEGRITY COMPROMISED BY CARGO LOAD
              </div>
            )}
          </div>
        </div>
      </main>

      {/* SHOP-REFUSAL HINT (Adam's pin, 2026-10-19): trying to open the
          workshop outside the well stamps shopRefusedAt; show the way home
          for a few seconds. HUD re-renders every frame, so this fades on
          its own when the stamp ages out. */}
      {shopRefusedAt && Date.now() - shopRefusedAt < 2800 && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-[70] pointer-events-none">
          <div className="hud-panel px-3 py-2 sm:px-4 rounded border-2 border-amber-500 bg-zinc-950/95 text-center shadow-[0_0_18px_rgba(245,158,11,0.35)]">
            <div className="text-[10px] sm:text-xs font-mono font-bold text-amber-400 tracking-widest">⚠ WORKSHOP LOCKED</div>
            <div className="text-[9px] sm:text-[10px] font-mono text-zinc-300">THE SHOP LIVES AT YOUR STAR — FLY INTO THE WELL (DASHED RING)</div>
          </div>
        </div>
      )}

      {/* CME WARNING: the enemy star is charging — its aim is locked, so
          the play is to move out of the line or get distance and let the
          wave dissipate before it reaches you. The sub-line shortens on
          phones where the long copy would wrap. */}
      {cmeWarning && (
        <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-[69] pointer-events-none">
          <div className="hud-panel px-3 py-2 sm:px-4 rounded border-2 border-red-500 bg-zinc-950/95 text-center shadow-[0_0_18px_rgba(239,68,68,0.4)] animate-pulse">
            <div className="text-[10px] sm:text-xs font-mono font-bold text-red-400 tracking-widest">⚠ CME INCOMING</div>
            <div className="text-[9px] sm:text-[10px] font-mono text-zinc-300">
              <span className="hidden sm:inline">BREAK THE AIM LINE — OR OUTRUN IT AND LET IT DISSIPATE</span>
              <span className="sm:hidden">DODGE THE AIM LINE!</span>
            </div>
          </div>
        </div>
      )}

      {/* DOCK PILLS — THE CHOICE (Adam's pin, 2026-10-20): inside the
          well (and only there), the player decides where the hold goes:
          FEED it to the star, BANK it, or open the WORKSHOP. The row
          appears the moment the ship enters the star's influence and is
          gone when it leaves — no permanent clutter, no buried menus.
          pointer-events-auto on the container is LOAD-BEARING: the HUD
          root is pointer-events-none, so without it the pills render and
          glow but clicks pass through to the canvas (Adam's bug report,
          2026-10-20). The DECOY pill below needs the same class. */}
      {bankInWell && !isShopOpen && (
        <div className="fixed bottom-[104px] sm:bottom-[76px] left-1/2 -translate-x-1/2 z-[56] flex gap-2 pointer-events-auto">
          <button
            onClick={onFeedCargo}
            disabled={carrying <= 0}
            className={`hud-panel px-3 py-1.5 rounded border font-mono text-[10px] sm:text-[11px] font-bold tracking-wider ${carrying > 0 ? 'border-amber-400 text-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.35)]' : 'border-zinc-800 text-zinc-600 opacity-50 cursor-not-allowed'}`}
          >
            ⭐ FEED{carrying > 0 ? ` ${carrying}U` : ''}
          </button>
          <button
            onClick={onDepositBank}
            disabled={carrying <= 0}
            className={`hud-panel px-3 py-1.5 rounded border font-mono text-[10px] sm:text-[11px] font-bold tracking-wider ${carrying > 0 ? 'border-[#33ff33] text-[#33ff33] shadow-[0_0_10px_rgba(51,255,51,0.35)]' : 'border-zinc-800 text-zinc-600 opacity-50 cursor-not-allowed'}`}
          >
            🏦 BANK{carrying > 0 ? ` ${carrying}U` : ''}
          </button>
          <button
            onClick={onOpenShop}
            className="hud-panel px-3 py-1.5 rounded border border-pink-500 font-mono text-[10px] sm:text-[11px] font-bold tracking-wider text-pink-400 shadow-[0_0_10px_rgba(219,39,119,0.35)]"
          >
            🔧 WORKSHOP
          </button>
        </div>
      )}

      {/* DECOY PILL: the beacon is a field tool, so its one-tap deploy
          lives outside the well-gated dock pills. Shows only while the
          Decoy Beacon is the equipped defense and none is live. */}
      {loadout.defense === 'decoy_beacon' && !decoyActive && (
        <div className={`fixed left-1/2 -translate-x-1/2 z-[56] pointer-events-auto ${bankInWell && !isShopOpen ? 'bottom-[146px] sm:bottom-[118px]' : 'bottom-[104px] sm:bottom-[76px]'}`}>
          <button
            onClick={onDeployDecoy}
            className="hud-panel px-3 py-1.5 rounded border border-pink-500 font-mono text-[10px] sm:text-[11px] font-bold tracking-wider text-pink-400 shadow-[0_0_10px_rgba(219,39,119,0.35)]"
          >
            📡 DEPLOY DECOY [X]
          </button>
        </div>
      )}

      {/* LOADOUT TILES — the equipped trio's permanent spot on the HUD:
          bottom-center, always visible, so the player can see their build
          (and spot an empty slot) without opening the shop. */}
      <div className="fixed bottom-24 sm:bottom-5 left-1/2 -translate-x-1/2 z-[55] flex gap-1.5 sm:gap-2 pointer-events-none">
        <div className="hud-panel px-2 py-1 sm:px-3 sm:py-1.5 rounded border border-pink-500/50 text-center min-w-[64px] sm:min-w-[84px]">
          <div className="text-[7px] sm:text-[8px] font-mono text-zinc-500 tracking-widest">BANK</div>
          <div className="text-[9px] sm:text-[11px] font-bold uppercase text-pink-400 leading-tight">🏦 {bankedScrap}U</div>
          <div className={`text-[7px] sm:text-[8px] font-mono ${bankInWell ? 'text-[#33ff33]' : 'text-zinc-500'}`}>{bankInWell ? 'IN THE WELL' : 'AT HOME STAR'}</div>
        </div>
        {([
          { slot: 'weapon' as const, label: 'WPN' },
          { slot: 'defense' as const, label: 'DEF' },
          { slot: 'hybrid' as const, label: 'HYB' },
        ]).map(({ slot, label }) => {
          const def = getLoadoutItem(loadout[slot]);
          const tier = def ? (arsenal[def.id] || 0) : 0;
          return (
            <div key={slot} className={`hud-panel px-2 py-1 sm:px-3 sm:py-1.5 rounded border text-center min-w-[64px] sm:min-w-[84px] ${def ? 'border-[#33ff33]/60' : 'border-zinc-800 opacity-50'}`}>
              <div className="text-[7px] sm:text-[8px] font-mono text-zinc-500 tracking-widest">{label}</div>
              <div className="text-[9px] sm:text-[11px] font-bold uppercase text-[#33ff33] leading-tight">
                {def ? `${def.icon} ${def.name}` : '— EMPTY —'}
              </div>
              {def && <div className="text-[7px] sm:text-[8px] font-mono text-pink-400">TIER {tier}</div>}
              {slot === 'defense' && def?.id === 'deflector_shield' && (
                <div className="text-[7px] sm:text-[8px] font-mono text-cyan-300">POOL {Math.ceil(shieldHp || 0)}/{shieldMaxFor(tier)}</div>
              )}
              {slot === 'defense' && def?.id === 'decoy_beacon' && (
                <div className="text-[7px] sm:text-[8px] font-mono text-pink-300">{decoyActive ? 'BEACON LIVE' : 'PRESS X / PILL'}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Workshop Overlay (Responsive for both Mobile and Desktop) */}
      {isShopOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-md pointer-events-auto">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-xl max-h-[90vh] flex flex-col hud-panel p-4 sm:p-6 md:p-8 border-4 relative overflow-hidden bg-zinc-950/95 shadow-[0_0_50px_rgba(51,255,51,0.15)] rounded-lg"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#33ff33]/5 to-transparent pointer-events-none" />
            
            <div className="relative z-10 flex flex-col h-full overflow-hidden">
              {/* Workshop Header */}
              <div className="flex justify-between items-center mb-4 sm:mb-6 border-b-2 border-zinc-800 pb-3">
                <div className="flex flex-col">
                  <h2 className="font-bold text-[#33ff33] uppercase tracking-widest text-base sm:text-lg leading-none">Nomadic Workshop</h2>
                  <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono mt-1">MOBILE REPAIR & ENHANCEMENT UNIT // READY</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-pink-500 text-[10px] sm:text-xs font-mono">HOLD {carrying}U · BANK {bankedScrap}U</div>
                    <div className="text-lg sm:text-xl font-bold text-pink-400 leading-none">{funds}U {bankInWell ? 'TOTAL' : 'IN HOLD'}</div>
                  </div>
                  {onCloseShop && (
                    <button
                      onClick={onCloseShop}
                      className="pitted-metal px-2.5 py-1 text-red-500 hover:text-white border border-red-900 text-xs font-mono font-bold rounded active:scale-95"
                    >
                      [X]
                    </button>
                  )}
                </div>
              </div>

              {/* Shop Tabs: SHIP = the five base upgrade tracks;
                  WEAPONS / DEFENSE / HYBRID = the Arsenal (src/loadout.ts) */}
              <div className="flex gap-1.5 mb-3 sm:mb-4">
                {([
                  { key: 'ship', label: '🚀 SHIP' },
                  { key: 'bank', label: '🏦 BANK' },
                  { key: 'weapon', label: '🔫 WEAPONS' },
                  { key: 'defense', label: '🛡️ DEFENSE' },
                  { key: 'hybrid', label: '♻️ HYBRID' },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setShopTab(tab.key)}
                    className={`flex-1 px-1 py-1.5 rounded text-[9px] sm:text-[10px] font-mono font-bold border touch-manipulation active:scale-95 ${
                      shopTab === tab.key
                        ? 'bg-[#33ff33] text-black border-[#33ff33] shadow-[0_0_8px_#33ff33]'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {shopTab === 'bank' && (
                <div className="flex flex-col gap-3 overflow-y-auto pr-1 max-h-[60vh] scrollbar-thin">
                  <p className="text-[10px] sm:text-xs opacity-70 leading-snug">
                    The bank is your star's <span className="text-[#33ff33] font-bold">gravity well</span> — banked scrap
                    orbits the star (watch the motes in the ring) and is safe there: it is not auto-fed on delivery
                    flybys and does not feed milestones until you withdraw it and deliver it.
                    Banking — deposit, withdraw, and spending savings — only works <span className="text-[#33ff33] font-bold">inside the well</span>:
                    fly home, stay outside the star's feeding reach (80U), and use the ring.
                    {bankInWell
                      ? <span className="block mt-1 text-[#33ff33] font-bold">YOU ARE IN THE WELL — BANK OPEN.</span>
                      : <span className="block mt-1 text-amber-500 font-bold">YOU ARE NOT IN THE WELL — BANK CLOSED.</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:gap-4">
                    <div className="pitted-metal p-3 sm:p-4 rounded-lg border border-zinc-700 text-center">
                      <div className="text-[9px] font-mono text-zinc-500 tracking-widest">IN HOLD</div>
                      <div className="text-xl sm:text-2xl font-bold text-pink-400">{carrying}U</div>
                    </div>
                    <div className="pitted-metal p-3 sm:p-4 rounded-lg border border-[#33ff33]/50 text-center">
                      <div className="text-[9px] font-mono text-zinc-500 tracking-widest">BANKED</div>
                      <div className="text-xl sm:text-2xl font-bold text-[#33ff33]">{bankedScrap}U</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={onDepositBank}
                      disabled={!bankInWell || carrying <= 0}
                      className={`flex-1 px-3 py-2 rounded text-[10px] sm:text-xs font-bold touch-manipulation active:scale-95 ${
                        bankInWell && carrying > 0 ? 'bg-[#33ff33] text-black shadow-[0_0_8px_#33ff33]' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      ⬇ DEPOSIT ALL ({carrying}U)
                    </button>
                    <button
                      onClick={onWithdrawBank}
                      disabled={!bankInWell || bankedScrap <= 0}
                      className={`flex-1 px-3 py-2 rounded text-[10px] sm:text-xs font-bold touch-manipulation active:scale-95 ${
                        bankInWell && bankedScrap > 0 ? 'bg-pink-600 text-white shadow-[0_0_8px_rgba(219,39,119,0.6)]' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      ⬆ WITHDRAW (FILL HOLD)
                    </button>
                  </div>
                  <p className="text-[9px] font-mono opacity-50">Withdraw fills the hold up to capacity (including the overload allowance). Deposit is unlimited — for now.</p>
                </div>
              )}

              {shopTab !== 'ship' && shopTab !== 'bank' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 overflow-y-auto pr-1 max-h-[60vh] scrollbar-thin">
                  {LOADOUT_ITEMS.filter(def => def.category === shopTab).map(def => {
                    const owned = arsenal[def.id] || 0;
                    const equipped = loadout[def.category] === def.id;
                    const nextCost = itemTierCost(def, owned);
                    const maxed = owned >= MAX_ITEM_TIER;
                    const canBuy = !maxed && funds >= nextCost;
                    // Swap pricing (Adam's pin): free into an empty slot,
                    // otherwise 60 + 20 per tier beyond the first of the
                    // item being swapped in.
                    const slotFilled = loadout[def.category] !== null;
                    const swapCost = slotFilled ? swapCostForTier(Math.max(1, owned)) : 0;
                    const canEquip = owned > 0 && !equipped && funds >= swapCost;
                    return (
                      <div key={def.id} className={`pitted-metal p-3 sm:p-4 flex flex-col gap-1.5 sm:gap-2 relative rounded-lg text-left border ${equipped ? 'border-[#33ff33] shadow-[0_0_10px_rgba(51,255,51,0.25)]' : 'border-zinc-700'}`}>
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{def.icon}</span>
                            <span className="text-xs sm:text-sm font-bold uppercase text-[#33ff33]">{def.name}</span>
                          </div>
                          <span className="text-[10px] sm:text-xs font-mono opacity-70 bg-zinc-800 px-1.5 py-0.5 rounded">
                            {owned > 0 ? `TIER ${owned}/${MAX_ITEM_TIER}` : 'NOT OWNED'}
                          </span>
                        </div>
                        <p className="text-[9px] sm:text-[10px] opacity-60 leading-tight">{def.desc}</p>
                        <div className="flex gap-1.5 mt-1 pt-1.5 border-t border-zinc-800/50">
                          <button
                            onClick={() => onBuyItem(def.id)}
                            disabled={!canBuy}
                            className={`flex-1 px-2 py-1 rounded text-[9px] sm:text-[10px] font-bold touch-manipulation active:scale-95 ${
                              canBuy ? 'bg-[#33ff33] text-black shadow-[0_0_8px_#33ff33]' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            }`}
                          >
                            {maxed ? 'MAX TIER' : owned > 0 ? `UPGRADE: ${nextCost}U` : `BUY: ${nextCost}U`}
                          </button>
                          {owned > 0 && (
                            <button
                              onClick={() => onEquipItem(def.id)}
                              disabled={!canEquip}
                              className={`flex-1 px-2 py-1 rounded text-[9px] sm:text-[10px] font-bold touch-manipulation active:scale-95 ${
                                equipped ? 'bg-zinc-800 text-[#33ff33] cursor-default' :
                                canEquip ? 'bg-pink-600 text-white shadow-[0_0_8px_rgba(219,39,119,0.6)]' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                              }`}
                            >
                              {equipped ? 'EQUIPPED' : swapCost > 0 ? `SWAP IN: ${swapCost}U` : 'EQUIP (FREE)'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Upgrades List (Scrollable on small mobile screens) */}
              {shopTab === 'ship' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 overflow-y-auto pr-1 max-h-[60vh] scrollbar-thin">
                {[
                  { type: 'thrust' as const, label: 'Thrust Vectoring', desc: 'Increases engine output & MAX VELOCITY', base: PHYSICS.UPGRADE_COSTS.THRUST, lvl: upgrades.thrust, icon: '🚀' },
                  { type: 'handling' as const, label: 'Neural Nav-Link', desc: 'Improves rotation speed & response', base: PHYSICS.UPGRADE_COSTS.HANDLING, lvl: upgrades.handling, icon: '🕹️' },
                  { type: 'attractor' as const, label: 'High-Gauss VAC', desc: 'Expands scrap collection radius', base: PHYSICS.UPGRADE_COSTS.ATTRACTOR, lvl: upgrades.attractor, icon: '🧲' },
                  { type: 'fuel' as const, label: 'Plasma Reserves', desc: 'Increases total fuel capacity', base: PHYSICS.UPGRADE_COSTS.FUEL, lvl: upgrades.fuelCap, icon: '⚡' },
                  { type: 'cargo' as const, label: 'Hull Expansion', desc: 'Increases max cargo hold capacity', base: PHYSICS.UPGRADE_COSTS.CARGO, lvl: upgrades.cargo, icon: '📦' }
                ].map(u => {
                  const cost = u.base + (u.lvl * Math.floor(u.base * 0.5));
                  const canAfford = funds >= cost;
                  return (
                    <button 
                      key={u.type}
                      onClick={() => onUpgrade(u.type)}
                      disabled={!canAfford}
                      className={`pitted-metal p-3 sm:p-4 flex flex-col gap-1.5 sm:gap-2 relative transition-all text-left rounded-lg touch-manipulation ${
                        canAfford ? 'hover:bg-zinc-900 border-zinc-700 active:scale-[0.98]' : 'opacity-40 border-zinc-800 grayscale cursor-not-allowed'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-1.5">
                          <span className="text-base">{u.icon}</span>
                          <span className="text-xs sm:text-sm font-bold uppercase text-[#33ff33]">{u.label}</span>
                        </div>
                        <span className="text-[10px] sm:text-xs font-mono opacity-70 bg-zinc-800 px-1.5 py-0.5 rounded">LVL {u.lvl}</span>
                      </div>
                      <p className="text-[9px] sm:text-[10px] opacity-60 leading-tight">{u.desc}</p>
                      <div className="flex justify-between items-center mt-1 pt-1.5 border-t border-zinc-800/50">
                        <span className="text-[10px] sm:text-[11px] font-mono text-pink-500 font-bold">COST: {cost}U</span>
                        <span className={`px-2.5 py-1 rounded text-[9px] sm:text-[10px] font-bold ${
                          canAfford ? 'bg-[#33ff33] text-black shadow-[0_0_8px_#33ff33]' : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {canAfford ? 'UPGRADE' : 'LOCKED'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              )}

              {/* Workshop Footer */}
              <div className="mt-4 pt-3 border-t border-zinc-800 flex justify-between items-center text-[10px] font-mono opacity-60">
                <span>[TAP OUTSIDE / X TO CLOSE]</span>
                <span className="animate-pulse">_SCAV_OS_ACTIVE</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* SYSCFG Popup (Responsive) */}
      {showSysCfg && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md pointer-events-auto">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rusted-frame p-6 sm:p-8 border-4 relative rounded-lg shadow-[0_0_100px_rgba(0,0,0,1)]">
            <div className="relative z-10">
              <div className="flex justify-between items-center mb-4 sm:mb-6 border-b-2 border-amber-900/40 pb-2">
                <div className="flex flex-col">
                  <h2 className="font-bold text-amber-600 uppercase tracking-widest text-xs sm:text-sm leading-none">System Configuration</h2>
                  <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono mt-1">SCAV-OS VERSION 70.26 [MOBILE & DESKTOP]</span>
                </div>
                <button 
                  onClick={() => setShowSysCfg(false)}
                  className="text-red-500 hover:text-red-400 text-xs font-mono font-bold px-2 py-1 bg-zinc-900 border border-red-900 rounded"
                >
                  [X] ABORT
                </button>
              </div>
              
              <div className="space-y-2.5 font-mono text-xs">
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">PLATFORM_RUNTIME:</span>
                  <span className="text-[#33ff33]">TOUCH_&_KB_ACTIVE</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">ENGINE_MODEL:</span>
                  <span className="text-zinc-300">VITE-V5.4_CORTEX</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">PHYSICS_ENGINE:</span>
                  <span className="text-zinc-300">G-CONST_PHY_MOD</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-1">
                  <span className="opacity-40">SHIP_SYSTEMS:</span>
                  <span className="text-[#33ff33]">MOD-CR90_ACTIVE</span>
                </div>
              </div>

              {/* Identity Plate Overlay */}
              <div className="mt-6 pt-4 border-t-2 border-zinc-900/60 flex flex-col items-center gap-2">
                <div className="pitted-metal px-4 sm:px-6 py-2 border border-zinc-800 animate-flicker shadow-2xl relative overflow-hidden group rounded">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                  <div className="font-mono text-[9px] leading-tight text-amber-600/80 text-center tracking-widest font-bold">
                    DESIGNED BY: <span className="text-amber-500">ADAM BAILEY</span>
                  </div>
                  <div className="font-mono text-[8px] text-[#33ff33]/40 text-center uppercase mt-0.5 tracking-tighter">
                    SCAV-TECH CUSTOM MODIFICATION // R-70.26
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-center">
                <button 
                  onClick={() => setShowSysCfg(false)}
                  className="pitted-metal px-8 sm:px-12 py-2.5 text-xs font-bold hover:bg-zinc-800 transition-all uppercase tracking-widest text-amber-500 border border-amber-900/30 hover:border-amber-500 shadow-lg rounded"
                >
                  Confirm Diagnostics
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

