import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Skull, RefreshCw, LogOut } from 'lucide-react';

interface ResultsOverlayProps {
  isVictory: boolean;
  isGameOver: boolean;
  teamScrap: number;
  totalScrapInfused: number;
  onRestart: () => void;
}

export const ResultsOverlay: React.FC<ResultsOverlayProps> = ({
  isVictory,
  isGameOver,
  teamScrap,
  totalScrapInfused,
  onRestart
}) => {
  const show = isVictory || isGameOver;

  if (!show) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          className={`w-full max-w-md p-8 border-4 relative overflow-hidden bg-zinc-950 shadow-[0_0_100px_rgba(0,0,0,0.5)] ${
            isVictory ? 'border-[#33ff33] shadow-[#33ff33]/20' : 'border-red-600 shadow-red-600/20'
          }`}
        >
          {/* Background glitch effect */}
          <div className="absolute inset-0 opacity-10 pointer-events-none">
             <div className="absolute inset-0 grid-bg" />
          </div>

          <div className="relative z-10 text-center">
            {isVictory ? (
              <>
                <motion.div 
                  initial={{ rotate: -10 }}
                  animate={{ rotate: 10 }}
                  transition={{ repeat: Infinity, duration: 2, repeatType: 'reverse' }}
                  className="mb-4 inline-block"
                >
                  <Trophy size={64} className="text-[#33ff33]" />
                </motion.div>
                <h1 className="text-4xl font-black text-[#33ff33] mb-2 tracking-tighter uppercase italic">
                  Systems Victorious
                </h1>
                <p className="text-zinc-400 font-mono text-xs mb-8 uppercase tracking-widest">
                  Enemy Star Neutralized // Core Security Restored
                </p>
              </>
            ) : (
              <>
                <div className="mb-4 inline-block">
                  <Skull size={64} className="text-red-600" />
                </div>
                <h1 className="text-4xl font-black text-red-600 mb-2 tracking-tighter uppercase italic">
                  Hull Breach
                </h1>
                <p className="text-zinc-400 font-mono text-xs mb-8 uppercase tracking-widest">
                  Signal Lost // Structural Failure Imminent
                </p>
              </>
            )}

            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-zinc-900/50 p-4 border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase mb-1">Scrap Collected</div>
                <div className="text-2xl font-bold text-white">{teamScrap}U</div>
              </div>
              <div className="bg-zinc-900/50 p-4 border border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase mb-1">Star Growth</div>
                <div className="text-2xl font-bold text-white">+{Math.floor(totalScrapInfused / 100)} Lvl</div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={onRestart}
                className={`pitted-metal w-full py-4 font-bold flex items-center justify-center gap-2 group transition-all ${
                  isVictory ? 'text-[#33ff33]' : 'text-red-500'
                }`}
              >
                <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-500" />
                <span>RE-INITIALIZE SYSTEMS</span>
              </button>
              
              <button
                onClick={() => window.location.reload()}
                className="text-zinc-600 hover:text-white transition-colors text-xs font-mono flex items-center justify-center gap-1 uppercase tracking-widest py-2"
              >
                <LogOut size={12} />
                <span>Return to Lobby (Placeholder)</span>
              </button>
            </div>
          </div>

          {/* Warning stripes */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500/20 to-transparent" />
          <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500/20 to-transparent" />
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
