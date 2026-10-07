import { Repeat, Zap } from 'lucide-react';
import type { SampleDef } from '@/audio/engine';
import { cn } from '@/lib/utils';

export const CATEGORY_COLORS: Record<string, string> = {
  drums: '#fb7185',
  perc: '#fbbf24',
  bass: '#a78bfa',
  melody: '#34d399',
  vox: '#22d3ee',
  fx: '#f472b6',
  misc: '#94a3b8',
};

interface PadButtonProps {
  sample: SampleDef;
  playing: boolean;
  pendingStop: boolean;
  flashed: boolean;
  beatPhase: number;
  hotkey?: string;
  suggested?: boolean;
  onTrigger: () => void;
}

export function PadButton({ sample, playing, pendingStop, flashed, beatPhase, hotkey, suggested, onTrigger }: PadButtonProps) {
  const color = CATEGORY_COLORS[sample.category] ?? CATEGORY_COLORS.misc;
  const active = playing || flashed;

  // Puls zum Beat für spielende Loops
  const pulse = playing && !pendingStop ? 0.72 + 0.28 * Math.max(0, 1 - beatPhase * 3) : undefined;

  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onTrigger();
      }}
      className={cn(
        'group relative aspect-square select-none overflow-hidden rounded-2xl border text-left',
        'transition-transform duration-75 active:scale-95 touch-none',
        active ? 'border-transparent' : 'border-white/10 bg-zinc-900/80 hover:border-white/25',
      )}
      style={
        active
          ? {
              background: `linear-gradient(145deg, ${color}, ${color}99)`,
              boxShadow: `0 0 ${playing ? 28 * (pulse ?? 1) : 18}px ${color}88, inset 0 0 24px #ffffff22`,
              opacity: pendingStop ? 0.55 : 1,
            }
          : suggested
            ? {
                borderColor: color,
                boxShadow: `0 0 14px ${color}66`,
                animation: 'pad-suggest 1.2s ease-in-out infinite',
              }
            : undefined
      }
    >
      {/* Tipp-Badge der KI */}
      {suggested && !active && (
        <div
          className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-black"
          style={{ background: color }}
        >
          Tipp
        </div>
      )}
      {/* Takt-Fortschrittsbalken unten für laufende Loops */}
      {playing && !pendingStop && (
        <div
          className="absolute bottom-0 left-0 h-1 bg-white/80"
          style={{ width: `${beatPhase * 100}%` }}
        />
      )}

      <div className="flex h-full flex-col justify-between p-2.5 sm:p-3">
        <div className="flex items-start justify-between gap-1">
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
              active ? 'bg-black/30 text-white' : 'text-zinc-400',
            )}
            style={!active ? { color } : undefined}
          >
            {sample.category}
          </span>
          {sample.type === 'loop' ? (
            <Repeat className={cn('h-3.5 w-3.5', active ? 'text-white' : 'text-zinc-500')} />
          ) : (
            <Zap className={cn('h-3.5 w-3.5', active ? 'text-white' : 'text-zinc-500')} />
          )}
        </div>

        <div>
          <div
            className={cn(
              'truncate text-xs font-semibold sm:text-sm',
              active ? 'text-white' : 'text-zinc-200',
            )}
            title={sample.name}
          >
            {sample.name}
          </div>
          <div className={cn('mt-0.5 text-[10px]', active ? 'text-white/70' : 'text-zinc-500')}>
            {sample.type === 'loop' ? (sample.bpm ? `${sample.bpm} BPM` : 'Loop') : 'One-Shot'}
            {hotkey ? ` · ${hotkey}` : ''}
          </div>
        </div>
      </div>
    </button>
  );
}
