import React, { useRef, useEffect } from 'react';
import { GameState } from '../types';
import { COLORS } from '../constants';

interface GameCanvasProps {
  state: GameState;
  width: number;
  height: number;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ state, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { ship, star, enemyStar, scrap, shakeAmount, glitchActive } = state;

    // Clear background
    ctx.fillStyle = COLORS.CRT_BG;
    ctx.fillRect(0, 0, width, height);

    // DRAW BACKGROUND STATIC SCRATCHES (Procedural / Static-ish)
    ctx.save();
    ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
    
    // CAMERA LOGIC: Offset everything by ship position to keep ship centered
    const camX = width / 2 - ship.pos.x;
    const camY = height / 2 - ship.pos.y;
    ctx.translate(camX, camY);

    // DRAW STARS
    [star, enemyStar].forEach(s => {
      const isHome = s.type === 'home';
      ctx.save();
      ctx.translate(s.pos.x, s.pos.y);

      // Delivery Zone indicator
      ctx.strokeStyle = isHome ? 'rgba(234, 88, 12, 0.2)' : 'rgba(244, 63, 94, 0.2)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, isHome ? 80 : 160, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

        // Star Noise Flares
        const isRecentlyHit = s.lastHitTime && (performance.now() - s.lastHitTime < 250);
        ctx.strokeStyle = isRecentlyHit ? '#fff' : (isHome ? COLORS.STAR_NOISE : '#f43f5e');
        ctx.lineWidth = isRecentlyHit ? 4 : 2;
        const flareCount = isHome ? 60 : 120;
        for(let i = 0; i < flareCount; i++) {
          const angle = (i / flareCount) * Math.PI * 2 + Math.random() * 0.1;
          let length = s.size * (1 + (isHome ? Math.random() * 0.8 : Math.random() * 0.4));
          
          if (isRecentlyHit && !isHome) {
            length *= 1.5 + Math.random();
          }

          // Add "instability" jitter to enemy flares if glitching
          const jitter = (!isHome && glitchActive) ? (Math.random() - 0.5) * 20 : 0;
          
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(angle) * (length + jitter), Math.sin(angle) * (length + jitter));
          ctx.stroke();
        }

        // Enemy Destabilization Arcs
        if (!isHome && (glitchActive || isRecentlyHit)) {
          ctx.strokeStyle = isRecentlyHit ? '#fff' : '#f43f5e';
          ctx.lineWidth = isRecentlyHit ? 2 : 1;
          for(let i = 0; i < (isRecentlyHit ? 15 : 5); i++) {
            ctx.beginPath();
            ctx.arc(0, 0, s.size * (0.5 + Math.random() * 2), Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
            ctx.stroke();
          }
        }

      // Star Core
      const gradient = ctx.createRadialGradient(0, 0, s.size * 0.2, 0, 0, s.size);
      if (isHome) {
        gradient.addColorStop(0, COLORS.STAR_CORE);
        gradient.addColorStop(1, COLORS.STAR_NOISE);
      } else {
        gradient.addColorStop(0, '#fecdd3');
        gradient.addColorStop(1, '#881337');
      }
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, s.size, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = isHome ? '#33ff33' : '#f43f5e';
      ctx.font = '10px monospace';
      ctx.fillText(isHome ? 'SYS: HOME_STAR_CORE' : 'SYS: ENEMY_STAR_CORE', -30, -s.size - 20);
      
      ctx.restore();
    });

    // DRAW SCRAP
    scrap.forEach(d => {
      ctx.fillStyle = d.color;
      ctx.fillRect(d.pos.x - 2, d.pos.y - 2, 4, 4);
    });

    // DRAW DEPLOYED CARGO
    (state.deployedCargo || []).forEach(c => {
      ctx.fillStyle = '#fff';
      
      // Outer glow
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#f472b6';
      
      // Core
      ctx.fillRect(c.pos.x - 2, c.pos.y - 2, 4, 4);
      
      ctx.shadowBlur = 0;
    });

    // DRAW SHIP
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    
    // Attractor Radius
    ctx.strokeStyle = glitchActive ? 'rgba(51, 255, 51, 0.2)' : 'rgba(51, 255, 51, 0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, ship.attractRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(ship.angle);
    
    // Cargo Visual (Sparks/Mass indicators)
    if (ship.carrying > 0) {
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 1;
      for (let i = 0; i < Math.min(ship.carrying, 12); i++) {
        const sx = (Math.random() - 0.5) * 30;
        const sy = (Math.random() - 0.5) * 30;
        ctx.strokeRect(sx, sy, 2, 2);
      }
    }

    // Ship Body (Gritty Shape)
    ctx.fillStyle = '#1a1a1c';
    ctx.strokeStyle = COLORS.CRT_GLOW;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ship.size, 0);
    ctx.lineTo(-ship.size, -ship.size * 0.7);
    ctx.lineTo(-ship.size * 0.6, 0);
    ctx.lineTo(-ship.size, ship.size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Thrust Flame
    if (ship.thrust) {
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.moveTo(-ship.size * 0.8, 0);
      ctx.lineTo(-ship.size * 2 - Math.random() * 15, (Math.random() - 0.5) * 8);
      ctx.lineTo(-ship.size * 0.8, (Math.random() - 0.5) * 4);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore(); // End Camera space

    // Global Overlay Effects
    if (glitchActive) {
      ctx.fillStyle = 'rgba(0, 255, 170, 0.05)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(100, 255, 255, 0.15)';
      ctx.fillRect(0, Math.random() * height, width, 5 + Math.random() * 20);
    }
  }, [state, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
};
