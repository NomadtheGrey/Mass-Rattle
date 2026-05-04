/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/HUD';
import { ResultsOverlay } from './components/ResultsOverlay';
import { useGameLoop } from './hooks/useGameLoop';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const { state, upgrade, restart } = useGameLoop(dimensions.width, dimensions.height);

  const shipVelocity = Math.sqrt(state.ship.vel.x ** 2 + state.ship.vel.y ** 2);

  return (
    <div ref={containerRef} className="crt-container w-full h-full flex items-center justify-center p-0">
      <ResultsOverlay 
        isVictory={state.isVictory} 
        isGameOver={state.isGameOver}
        teamScrap={state.teamScrap}
        totalScrapInfused={state.star.totalScrapInfused}
        onRestart={restart}
      />
      
      {/* HUD Overlay */}
      <HUD 
        starMass={state.star.mass} 
        velocity={shipVelocity} 
        glitch={state.glitchActive}
        carrying={state.ship.carrying}
        teamScrap={state.teamScrap}
        totalScrapInfused={state.star.totalScrapInfused}
        fuel={state.ship.fuel}
        maxFuel={state.ship.maxFuel}
        shipHealth={state.ship.health}
        maxShipHealth={state.ship.maxHealth}
        enemyIntegrity={state.enemyStar.integrity}
        isShopOpen={state.isShopOpen}
        shipPos={state.ship.pos}
        starPos={state.star.pos}
        scrapList={state.scrap}
        enemyStarPos={state.enemyStar.pos}
        useAnalogGauges={state.useAnalogGauges}
        upgrades={state.ship.upgrades}
        slip={state.slip}
        onUpgrade={upgrade}
      />

      {/* Main Game Surface with Thick Frame */}
      <div className="w-full h-full border-[12px] border-[#1a1a1c] relative overflow-hidden bg-black">
        
        {/* The Game Canvas Container - Full background layer */}
        <div className="absolute inset-0 z-0">
          <div className="w-full h-full relative bg-[#050505]">
            <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
            <GameCanvas state={state} width={dimensions.width} height={dimensions.height} />
          </div>
        </div>

        {/* CRT Overlays */}
        <div className="crt-scanlines pointer-events-none" />
        <div className="crt-vignette pointer-events-none" />
        <div className="noise-texture pointer-events-none" />
      </div>

      {/* Controls Help */}
      <div className="fixed bottom-4 left-4 text-[10px] opacity-20 uppercase tracking-widest pointer-events-none z-[60] flex flex-col">
        <span>[WASD/ARROWS] THRUST/ROTATION | [Q/E/R] MANUAL VAC PULL</span>
        <span>[1-4] UPGRADES | [SPACE] EJECT CARGO PULSE (SABOTAGE ENEMY / INFUSE HOME)</span>
      </div>
    </div>
  );
}
