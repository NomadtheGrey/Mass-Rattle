/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { TEAM_COLORS } from './net/protocol';
import { HUD } from './components/HUD';
import { ResultsOverlay } from './components/ResultsOverlay';
import { MobileControls } from './components/MobileControls';
import { useGameLoop } from './hooks/useGameLoop';
import { TUTORIAL_STEPS as TUTORIAL_TABLE, type TutorialSnapshot, type TutorialStepId, type TutorialSpotlightId } from './tutorial';
import { inBankWell } from './bank';
import { LobbyScreen } from './components/lobby/LobbyScreen';
import { ChatPanel } from './components/ChatPanel';
import { useNetClient, NetSessionContext } from './net/useNetClient';
import { RepurchaseOverlay } from './components/RepurchaseOverlay';
import { repurchasePriceFor } from './sim/deathEconomy';
import { escortKindOf, healCapPctFor } from './shipProgression';

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
  // NAMEPLATE bridge (Adam, 2026-10-21): in a net room, every seat's
  // issued callsign + team color, keyed by the seat-scoped ownerId
  // the sim stamps on its ships. The canvas joins on that id — the
  // sim's seat state carries no callsign, by contract. Solo: no room,
  // no labels, no plates.
  const seatLabels = useMemo(() => {
    if (!net.room) return undefined;
    const map: Record<string, { callsign: string; color: string }> = {};
    for (const s of net.room.seats) {
      map[s.ownerId] = { callsign: s.occupant.callsign, color: TEAM_COLORS[s.teamId] };
    }
    return map;
  }, [net.room]);

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
    buyTurretMount,
    buildDefenseDrone,
    debugGrantScrap,
    debugGrantFed,
    debugJumpTo,
    buildEscort,
    switchLine,
    buildDrone,
    setDeliveryMode,
    setRepairing,
    dockToHost,
    undock,
    setHarborOpen,
    undockGuest,
    selectWeaponSlot,
    setTarget,
    repurchaseShip,
    feedCargo,
    depositBank, 
    withdrawBank, 
    deployDecoy, 
    restart,
    tutorial,
    tutorialMarker,
    startTutorial,
    skipTutorialStep,
    endTutorial,
    setVirtualControl, 
    setAnalogStick, 
    toggleShop, 
    toggleGauges 
  } = useGameLoop(dimensions.width, dimensions.height, net);

  // SOLO CALLSIGN (Adam, 2026-10-23): one stored name for the
  // pilot on this device — typed in the YOUR ORDERS modal, taken
  // by the lobby as its default callsign, and flown as the solo
  // nameplate. A client pref only (localStorage, mr.* family):
  // never game state; in solo it never touches the wire.
  const [soloCallsign, setSoloCallsignState] = useState<string>(() => {
    try { return localStorage.getItem('mr.callsign') ?? ''; } catch { return ''; }
  });
  const setSoloCallsign = useCallback((name: string) => {
    setSoloCallsignState(name);
    try { localStorage.setItem('mr.callsign', name); } catch { /* session-only */ }
  }, []);

  const [lobbyOpen, setLobbyOpen] = useState(false);
  useEffect(() => {
    if (net.room && net.room.phase !== 'lobby') setLobbyOpen(false);
  }, [net.room]);
  // REPURCHASE (P2-5): the local seat is death-economy shipless when
  // its seat record has no ship and at least one death. Net matches
  // only — an SP death is game over and ResultsOverlay owns it. The
  // quoted price is the sim's own function; the host validates.
  const localOwnerId = net.mySeat?.ownerId ?? state.ship.ownerId;
  // SOLO NAMEPLATE: with no room joined, the stored callsign
  // plates the LOCAL seat only (the solo opponent stays
  // label-less). The color is the seat's own team color — the
  // same TEAM_COLORS read the room map uses.
  // GUIDED FLIGHT snapshot (integration, 2026-10-23): the loop
  // publishes {active, step} + the marker; the step table (shared
  // seam, src/tutorial.ts) supplies the id + spotlight. HUD and
  // the canvas render surfaces only — truth stays in the engine.
  const tutorialSnapshot: TutorialSnapshot | null = useMemo(() => {
    if (!tutorial) return null;
    const def = TUTORIAL_TABLE[tutorial.step];
    return {
      active: tutorial.active,
      step: tutorial.step,
      done: tutorial.done,
      stepId: (def?.id ?? 'fly') as TutorialStepId,
      spotlight: (def?.spotlight ?? null) as TutorialSpotlightId | null,
      marker: tutorialMarker ?? null,
    };
  }, [tutorial, tutorialMarker]);

  const seatLabelsSolo = useMemo(() => {
    if (seatLabels) return seatLabels;
    const name = soloCallsign.trim();
    if (!name) return undefined;
    const seat = state.seats.find(x => x.ownerId === localOwnerId);
    return { [localOwnerId]: { callsign: name, color: TEAM_COLORS[seat?.teamId ?? 'blue'] } };
  }, [seatLabels, soloCallsign, localOwnerId, state.seats]);

  const localSeat = state.seats.find(seat => seat.ownerId === localOwnerId);
  // DEATH TAX display feed (Adam, 2026-10-21): the seat's redeploy
  // deadline (BackGround's death-tax sim, seat.respawnAt — landed
  // 33570ec; the wait is respawnWaitMsFor in sim/deathEconomy.ts).
  const localRespawnAt = localSeat
    ? ((localSeat as unknown as { respawnAt?: number }).respawnAt ?? null)
    : null;
  const localSeatDead = !!(
    net.room && net.room.phase === 'live' && !net.matchEnded &&
    localSeat && localSeat.ship === null && localSeat.deaths > 0
  );
  // Repurchase dismissal (Adam, 2026-10-21): the dead player may
  // dismiss the buy-back panel to watch the field; a persistent pill
  // (below) is the way back for as long as the seat is dead, and a
  // NEW death reopens the panel outright.
  const [repurchaseDismissed, setRepurchaseDismissed] = useState(false);
  const localDeaths = localSeat?.deaths ?? 0;
  useEffect(() => { setRepurchaseDismissed(false); }, [localDeaths]);
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
          className="fixed top-2 left-1/2 -translate-x-1/2 z-[95] px-3 py-1.5 rounded-full bg-zinc-900/70 border border-[#33ff33]/60 text-[#33ff33] text-[10px] font-mono font-bold tracking-widest shadow-[0_0_10px_rgba(51,255,51,0.25)] active:scale-95 touch-manipulation flex items-center gap-1.5"
        >
          {/* MODE PILL (Adam, library look 2026-10-23): the door is
              also the mode indicator — MULTIPLAYER and SOLO side by
              side, the CURRENT mode lit. Solo is any moment with no
              room joined (net.room is the one truth); in a room the
              second segment carries the room form instead. */}
          {net.room ? (
            <>
              <span>🌐 MULTIPLAYER</span>
              <span className="opacity-50">·</span>
              <span className="bg-[#33ff33] text-zinc-950 px-1.5 py-0.5 rounded-full">ROOM {net.room.code} — LOBBY</span>
            </>
          ) : (
            <>
              <span className="opacity-50">🌐 MULTIPLAYER</span>
              <span className="opacity-50">·</span>
              <span className="bg-[#33ff33] text-zinc-950 px-1.5 py-0.5 rounded-full">☀ SOLO</span>
            </>
          )}
        </button>
      )}
      {localSeatDead && localSeat && !repurchaseDismissed && (
        <RepurchaseOverlay
          deaths={localSeat.deaths}
          bankedScrap={localSeat.bankedScrap}
          price={repurchasePriceFor(localSeat.bankedScrap, localSeat.deaths)}
          onRepurchase={() => repurchaseShip(localSeat.ownerId)}
          onLeaveMatch={() => { net.leaveRoom(); setLobbyOpen(false); }}
          onForfeitMatch={() => { net.forfeitRoom(); setLobbyOpen(false); }}
          onDismiss={() => setRepurchaseDismissed(true)}
          respawnAt={localRespawnAt}
        />
      )}
      {localSeatDead && localSeat && repurchaseDismissed && (
        <button
          type="button"
          onClick={() => setRepurchaseDismissed(false)}
          className="fixed bottom-[150px] sm:bottom-[122px] left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-full bg-zinc-950/70 border-2 border-red-500 text-red-400 font-mono text-[11px] font-bold tracking-widest shadow-[0_0_16px_rgba(239,68,68,0.4)] animate-pulse active:scale-95 touch-manipulation"
        >
          {localRespawnAt && localRespawnAt > performance.now()
            ? `☠ INSURANCE PAID — REDEPLOY IN ${Math.floor(Math.max(0, Math.ceil((localRespawnAt - performance.now()) / 1000)) / 60)}:${String(Math.max(0, Math.ceil((localRespawnAt - performance.now()) / 1000)) % 60).padStart(2, '0')}`
            : `☠ YOU ARE DEAD — REPURCHASE ${repurchasePriceFor(localSeat.bankedScrap, localSeat.deaths) === 0 ? 'FREE' : `${repurchasePriceFor(localSeat.bankedScrap, localSeat.deaths)}U`}`}
        </button>
      )}
      {lobbyOpen && (
        <LobbyScreen
          clientState={net.clientState}
          room={net.room}
          myPlayerId={net.myPlayerId}
          defaultCallsign={soloCallsign}
          initialCode={urlRoomCode}
          reclaimedOwnerId={net.reclaimedOwnerId}
          notice={net.notice}
          callbacks={{
            onCreate: (name, starCount, isPrivate, callsign, callsignPassword) => {
              if (callsign.trim()) setSoloCallsign(callsign.trim());
              net.createRoom(name, starCount, isPrivate, callsign, callsignPassword);
            },
            onJoin: (code, callsign, callsignPassword) => {
              if (callsign.trim()) setSoloCallsign(callsign.trim());
              net.joinRoom(code, callsign, callsignPassword);
            },
            onStart: net.startMatch,
            onSetTeam: net.setTeam,
            onLeave: () => { net.leaveRoom(); setLobbyOpen(false); },
            onForfeit: () => { net.forfeitRoom(); setLobbyOpen(false); },
            onClose: () => setLobbyOpen(false),
          }}
        />
      )}
      {net.room && !lobbyOpen && <ChatPanel variant="overlay" />}
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
        enemyTotalInfused={state.enemyStar.totalScrapInfused}
        myTeamId={net.room ? (net.mySeat?.teamId ?? null) : null}
        enemyTeamId={net.room ? (state.seats.find(seat => seat.ownerId === state.enemyStar.ownerId)?.teamId ?? null) : null}
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
        playerDrones={state.drones.filter(d => d.owner === 'player' && d.mode !== 'defense' && !d.starFleet).length}
        playerDefenseDrones={state.drones.filter(d => d.owner === 'player' && d.mode === 'defense').length}
        onBuildDefenseDrone={buildDefenseDrone}
        onDebugGrantScrap={debugGrantScrap}
        onDebugGrantFed={debugGrantFed}
        onDebugJumpTo={debugJumpTo}
        escortCounts={{ skiff: state.escorts.filter(e => e.ownerId === state.ship.ownerId && escortKindOf(e) === 'skiff').length, stinger: state.escorts.filter(e => e.ownerId === state.ship.ownerId && escortKindOf(e) === 'stinger').length, lancer: state.escorts.filter(e => e.ownerId === state.ship.ownerId && escortKindOf(e) === 'lancer').length }}
        onBuildEscort={buildEscort}
        starFleetCount={state.drones.filter(d => d.starFleet && d.ownerId === state.ship.ownerId).length}
        enemyStarFleetCount={state.drones.filter(d => d.starFleet && d.ownerId === (state.seats.find(se => se.starId === state.enemyStar.id)?.ownerId ?? '')).length}
        deliveryMode={state.seats.find(se => se.ownerId === state.ship.ownerId)?.deliveryMode ?? 'feed'}
        onSetDeliveryMode={setDeliveryMode}
        onSetRepairing={setRepairing}
        seats={state.seats}
        seatLabels={seatLabelsSolo}
        soloCallsign={soloCallsign}
        onSetSoloCallsign={setSoloCallsign}
        roomCallsign={net.mySeat?.occupant.callsign ?? null}
        tutorial={tutorialSnapshot}
        onStartTutorial={startTutorial}
        onSkipTutorialStep={skipTutorialStep}
        onEndTutorial={endTutorial}
        onDockToHost={dockToHost}
        onUndock={undock}
        onSetHarborOpen={setHarborOpen}
        onUndockGuest={undockGuest}
        onSelectWeaponSlot={selectWeaponSlot}
        ship={state.ship}
        drones={state.drones}
        escorts={state.escorts}
        onBuyType={buyType}
        onBuyHullStep={buyHullStep}
        onBuyTurretMount={buyTurretMount}
        turretMounts={state.ship.turretMounts}
        onSwitchLine={switchLine}
        onBuildDrone={buildDrone}
      />

      {/* Touch Screen Mobile Controller (iPhones / Androids) */}
      <MobileControls
        onControlChange={setVirtualControl}
        onAnalogStick={setAnalogStick}
        onOpenWorkshop={() => toggleShop(true)}
        tutorialRadarPulse={!!tutorialSnapshot?.active && tutorialSnapshot.spotlight === 'radar'}
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
        repairing={state.ship.repairing !== false}
        activelyRepairing={state.ship.repairing !== false && state.ship.health < state.ship.maxHealth * healCapPctFor(state.ship.line, state.ship.typeTier) && state.ship.carrying > 0}
        onToggleRepair={() => setRepairing(state.ship.repairing === false)}
      />

      {/* Main Game Surface with Thick Frame */}
      <div className="w-full h-full border-0 sm:border-[8px] md:border-[12px] border-[#1a1a1c] relative overflow-hidden bg-black">
        
        {/* The Game Canvas Container - Full background layer */}
        <div className="absolute inset-0 z-0">
          <div className="w-full h-full relative bg-[#050505]">
            <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" />
            <GameCanvas state={state} width={dimensions.width} height={dimensions.height} seatLabels={seatLabelsSolo} tutorialMarker={tutorialMarker} onSetTarget={setTarget} />
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
