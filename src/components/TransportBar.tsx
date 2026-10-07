import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Square, Volume2, AudioWaveform, OctagonX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface TransportBarProps {
  bpm: number;
  beatPhase: number;
  transportRunning: boolean;
  onBpm: (bpm: number) => void;
  onStopAll: () => void;
  onPanic: () => void;
  onVolume: (v: number) => void;
  onFilter: (n: number) => void;
}

export function TransportBar({
  bpm, beatPhase, transportRunning, onBpm, onStopAll, onPanic, onVolume, onFilter,
}: TransportBarProps) {
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-white/10 bg-zinc-900/70 px-4 py-3 backdrop-blur">
      {/* Beat-Indikator */}
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-2.5 w-2.5 rounded-full transition-colors duration-75"
            style={{
              background:
                transportRunning && currentBeat === i
                  ? i === 0
                    ? '#fb7185'
                    : '#facc15'
                  : '#3f3f46',
              boxShadow: transportRunning && currentBeat === i ? '0 0 8px currentColor' : undefined,
            }}
          />
        ))}
      </div>

      {/* BPM */}
      <div className="flex items-center gap-1.5">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onBpm(bpm - 1)}>
          <Minus className="h-4 w-4" />
        </Button>
        <div className="w-20 text-center">
          <div className="text-2xl font-black tabular-nums leading-none">{bpm}</div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">BPM</div>
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

      {/* Filter */}
      <div className="flex min-w-36 flex-1 items-center gap-2">
        <AudioWaveform className="h-4 w-4 shrink-0 text-zinc-400" />
        <Slider
          defaultValue={[100]}
          max={100}
          step={1}
          onValueChange={([v]) => onFilter(v / 100)}
          className="flex-1"
        />
      </div>

      {/* Lautstärke */}
      <div className="flex min-w-28 items-center gap-2">
        <Volume2 className="h-4 w-4 shrink-0 text-zinc-400" />
        <Slider
          defaultValue={[90]}
          max={100}
          step={1}
          onValueChange={([v]) => onVolume(v / 100)}
        />
      </div>

      {/* Stop */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={onStopAll}
          disabled={!transportRunning}
        >
          <Square className="h-3.5 w-3.5" /> Loops stoppen
        </Button>
        <Button variant="destructive" size="sm" className="gap-1.5" onClick={onPanic}>
          <OctagonX className="h-3.5 w-3.5" /> Panic
        </Button>
      </div>
    </div>
  );
}
