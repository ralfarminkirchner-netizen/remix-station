import { useEffect, useState } from 'react';
import { AudioWaveform, Waves, Repeat2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface FXStripProps {
  onFilter: (n: number) => void;
  onEcho: (n: number) => void;
  onRollStart: (fraction: number) => void;
  onRollEnd: () => void;
  enabled: boolean;
}

/** FX-Sektion Remixlive-Stil: Filter, Echo, momentane Beat-Rolls. */
export function FXStrip({ onFilter, onEcho, onRollStart, onRollEnd, enabled }: FXStripProps) {
  const [rolling, setRolling] = useState<number | null>(null);

  useEffect(() => {
    const up = () => {
      if (rolling !== null) {
        setRolling(null);
        onRollEnd();
      }
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [rolling, onRollEnd]);

  const rollBtn = (fraction: number, label: string) => (
    <button
      disabled={!enabled}
      onPointerDown={(e) => {
        e.preventDefault();
        if (!enabled) return;
        setRolling(fraction);
        onRollStart(fraction);
      }}
      className={cn(
        'flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-black transition-all',
        rolling === fraction
          ? 'border-transparent bg-cyan-400 text-black shadow-[0_0_18px_#22d3ee88]'
          : 'border-white/15 bg-zinc-900 text-cyan-300 hover:border-cyan-400/50',
        !enabled && 'opacity-40',
      )}
    >
      <Repeat2 className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/10 bg-zinc-900/70 px-4 py-3 backdrop-blur">
      <div className="flex min-w-40 flex-1 items-center gap-2">
        <AudioWaveform className="h-4 w-4 shrink-0 text-fuchsia-400" />
        <span className="w-12 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Filter</span>
        <Slider defaultValue={[100]} max={100} step={1} onValueChange={([v]) => onFilter(v / 100)} className="flex-1" />
      </div>
      <div className="flex min-w-40 flex-1 items-center gap-2">
        <Waves className="h-4 w-4 shrink-0 text-cyan-400" />
        <span className="w-12 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Echo</span>
        <Slider defaultValue={[0]} max={100} step={1} onValueChange={([v]) => onEcho(v / 100)} className="flex-1" />
      </div>
      <div className="flex items-center gap-2">
        {rollBtn(1 / 4, '1/4')}
        {rollBtn(1 / 8, '1/8')}
        {rollBtn(1 / 16, '1/16')}
      </div>
    </div>
  );
}
