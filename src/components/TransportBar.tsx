import { useEffect, useRef, useState } from 'react';
import { Minus, Play, Plus, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface TransportBarProps {
  bpm: number;
  beatPhase: number;
  running: boolean;
  onPlay: () => void;
  onStop: () => void;
  onBpm: (bpm: number) => void;
  onVolume: (v: number) => void;
}

export function TransportBar({ bpm, beatPhase, running, onPlay, onStop, onBpm, onVolume }: TransportBarProps) {
  const [, setTaps] = useState<number[]>([]);
  const tapTimeout = useRef<number>(0);

  const tapTempo = () => {
    const now = performance.now();
    setTaps((prev) => {
      const next = [...prev.filter((t) => now - t < 2500), now].slice(-6);
      if (next.length >= 2) {
        const avg = (next[next.length - 1] - next[0]) / (next.length - 1);
        onBpm(Math.round(60000 / avg));
      }
      return next;
    });
    window.clearTimeout(tapTimeout.current);
    tapTimeout.current = window.setTimeout(() => setTaps([]), 2500);
  };

  useEffect(() => () => window.clearTimeout(tapTimeout.current), []);

  const currentBeat = Math.floor(beatPhase * 4);

  return (
    <div className="flex items-center gap-x-4 gap-y-3 rounded-2xl border border-white/10 bg-zinc-900/70 px-4 py-3 backdrop-blur">
      {/* Play / Stop */}
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          running ? onStop() : onPlay();
        }}
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all active:scale-90',
          running
            ? 'bg-rose-500 shadow-[0_0_20px_#f43f5e88] hover:bg-rose-400'
            : 'bg-emerald-500 shadow-[0_0_20px_#10b98166] hover:bg-emerald-400',
        )}
        aria-label={running ? 'Stop' : 'Play'}
      >
        {running ? (
          <Square className="h-5 w-5 fill-black text-black" />
        ) : (
          <Play className="ml-0.5 h-5 w-5 fill-black text-black" />
        )}
      </button>

      {/* Beat-Indikator */}
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-2.5 w-2.5 rounded-full transition-colors duration-75"
            style={{
              background: running && currentBeat === i ? (i === 0 ? '#fb7185' : '#facc15') : '#3f3f46',
              boxShadow: running && currentBeat === i ? '0 0 8px currentColor' : undefined,
            }}
          />
        ))}
      </div>

      {/* BPM */}
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onBpm(bpm - 1)}>
          <Minus className="h-4 w-4" />
        </Button>
        <div className="w-16 text-center">
          <div className="text-2xl font-black tabular-nums leading-none">{bpm}</div>
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">BPM</div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onBpm(bpm + 1)}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-1 border-white/15"
          onPointerDown={(e) => {
            e.preventDefault();
            tapTempo();
          }}
        >
          TAP
        </Button>
      </div>

      <div className="flex-1" />

      {/* Lautstärke */}
      <div className="flex w-32 items-center gap-2 sm:w-44">
        <Volume2 className="h-4 w-4 shrink-0 text-zinc-400" />
        <Slider defaultValue={[90]} max={100} step={1} onValueChange={([v]) => onVolume(v / 100)} />
      </div>
    </div>
  );
}
