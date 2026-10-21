/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/HUD';
import { ResultsOverlay } from './components/ResultsOverlay';
import { MobileControls } from './components/MobileControls';
import { useGameLoop } from './hooks/useGameLoop';
import { inBankWell } from './bank';
import { LobbyScreen } from './components/lobby/LobbyScreen';
import { useNetClient, NetSessionContext } from './net/useNetClient';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isMobileRadarOpen, setIsMobileRadarOpen] = useState(false);
  
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

  // MULTIPLAYER (Phase 2, UI lane + P2-3b binding): the net session
  // is created BEFORE the loop so it can be handed in — host/guest
  // modes live inside useGameLoop behind room guards, and with no
  // room the loop is exactly the solo game. The lobby overlays the
  // game; when a room's phase leaves 'lobby' the game screen takes
  // over, and the session also rides NetSessionContext to the shell.
  const net = useNetClient();

  const {
    state,
    upgrade,
    buyItem,
    equipItem,
    // Ship progression (Phase 3): buyType / buyHullStep / switchLine /
    // buildDrone are consumed here and ready to thread into the HUD
    // exactly like onFeedCargo below — the prop hand-off lands WITH the
    // UI lane's workshop faces, because HUDProps is a closed interface
    // in HUD.tsx (passing them today would not typecheck; the UI lane
    // grows the interface and these four props in one move).
    buyType,
    buyHullStep,
    switchLine,
    buildDrone,
    feedCargo,
    depositBank, 
    withdrawBank, 
    deployDecoy, 
    restart, 
    setVirtualControl, 
    setAnalogStick, 
    toggleShop, 
    toggleGauges 
  } = useGameLoop(dimensions.width, dimensions.height, net);

  const [lobbyOpen, setLobbyOpen] = useState(false);
  useEffect(() => {
    if (net.room && net.room.phase !== 'lobby') setLobbyOpen(false);
  }, [net.room]);
  const urlRoomCode = React.useMemo(
    () => new URLSearchParams(window.location.search).get('room') || '',
    []
  );
  useEffect(() => { if (urlRoomCode) setLobbyOpen(true); }, [urlRoomCode]);

  const shipVelocity = Math.sqrt(state.ship.vel.x ** 2 + state.ship.vel.y ** 2);
  // The bank is the home star's gravity well: HUD affordability and the
  // BANK tab key off this one check, matching the game loop's gating.
  const bankInWell = inBankWell(state.ship.pos, state.star.pos, state.star.size);

  const handleToggleMobileRadar = useCallback(() => {
    setIsMobileRadarOpen(prev => !prev);
  }, []);

  return (
    <NetSessionContext.Provider value={net}>
    <div ref={containerRef} className="crt-container w-full h-full flex items-center justify-center p-0 select-none touch-none">
      {/* Multiplayer door: opens the lobby; in a live room it becomes
          the room chip (tap to see the room / leave). */}
      {!lobbyOpen && (
        <button
          onClick={() => setLobbyOpen(true)}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[95] px-3 py-1.5 rounded-full bg-zinc-900/90 border border-[#33ff33]/60 text-[#33ff33] text-[10px] font-mono font-bold tracking-widest shadow-[0_0_10px_rgba(51,255,51,0.25)] active:scale-95 touch-manipulation"
        >
          {net.room ? `🌐 ROOM ${net.room.code} — LOBBY` : '🌐 MULTIPLAYER'}
        </button>
      )}
      {lobbyOpen && (
        <LobbyScreen
          clientState={net.clientState}
          room={net.room}
          myPlayerId={net.myPlayerId}
          defaultCallsign={window.localStorage.getItem('mr.callsign') || ''}
          initialCode={urlRoomCode}
          reclaimedOwnerId={net.reclaimedOwnerId}
          notice={net.notice}
          callbacks={{
            onCreate: (name, starCount, isPrivate, callsign) => {
              window.localStorage.setItem('mr.callsign', callsign);
              net.createRoom(name, starCount, isPrivate, callsign);
            },
            onJoin: (code, callsign) => {
              window.localStorage.setItem('mr.callsign', callsign);
              net.joinRoom(code, callsign);
            },
            onStart: net.startMatch,
            onLeave: () => { net.leaveRoom(); setLobbyOpen(false); },
          }}
        />
      )}
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
        arsenal={state.ship.arsenal}
        loadout={state.ship.loadout}
        onBuyItem={buyItem}
        onEquipItem={equipItem}
        bankedScrap={state.bankedScrap}
        bankInWell={bankInWell}
        shopRefusedAt={state.shopRefusedAt}
        shieldHp={state.ship.shield}
        decoyActive={!!state.decoy}
        cmeWarning={!!(state.enemyStar.cmeChargeEndsAt && state.enemyStar.cmeChargeEndsAt > performance.now())}
        onDeployDecoy={deployDecoy}
        onFeedCargo={feedCargo}
        onDepositBank={depositBank}
        onWithdrawBank={withdrawBank}
        isMobileRadarOpen={isMobileRadarOpen}
        onToggleMobileRadar={handleToggleMobileRadar}
        onCloseShop={() => toggleShop(false)}
        onOpenShop={() => toggleShop(true)}
        onToggleGauges={toggleGauges}
        shipLine={state.ship.line}
        typeTier={state.ship.typeTier}
        hullSteps={state.ship.hullSteps}
        lineSwitchesUsed={state.ship.lineSwitchesUsed}
        playerDrones={state.drones.filter(d => d.owner === 'player').length}
        onBuyType={buyType}
        onBuyHullStep={buyHullStep}
        onSwitchLine={switchLine}
        onBuildDrone={buildDrone}
      />

      {/* Touch Screen Mobile Controller (iPhones / Androids) */}
      <MobileControls
        onControlChange={setVirtualControl}
        onAnalogStick={setAnalogStick}
        onOpenWorkshop={() => toggleShop(true)}
        onToggleRadar={handleToggleMobileRadar}
        onToggleGauges={toggleGauges}
        carrying={state.ship.carrying}
        fuel={state.ship.fuel}
        maxFuel={state.ship.maxFuel}
        weaponId={state.ship.loadout.weapon}
        inWell={bankInWell}
        bankedScrap={state.bankedScrap}
        onFeedCargo={feedCargo}
        onDepositBank={depositBank}
        onWithdrawBank={withdrawBank}
        decoyEquipped={state.ship.loadout.defense === 'decoy_beacon'}
        decoyActive={!!state.decoy}
        onDeployDecoy={deployDecoy}
      />

      {/* Main Game Surface with Thick Frame */}
      <div className="w-full h-full border-0 sm:border-[8px] md:border-[12px] border-[#1a1a1c] relative overflow-hidden bg-black">
        
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

      {/* Controls help lives in the HUD now (desktop CONTROLS card in
          HUD.tsx + the HELP legend in MobileControls.tsx). The old
          20%-opacity footer that stood here was stale — it never
          learned FIRE [F] or DECOY [X] — so it was retired. */}
    </div>
    </NetSessionContext.Provider>
  );
}
