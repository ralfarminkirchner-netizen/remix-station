import { useEffect, useRef, useState } from 'react';
import { Repeat, Zap } from 'lucide-react';
import { engine, type SampleDef } from '@/audio/engine';
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  useEffect(() => {
    let live = true;
    // Peaks erst nach User-Geste (AudioContext) laden – trotzdem sofort versuchen
    const load = () => {
      engine.peaks(sample).then((p) => {
        if (live) setPeaks(p);
      }).catch(() => {});
    };
    const t = setTimeout(load, 100);
    window.addEventListener('pointerdown', load, { once: true });
    return () => {
      live = false;
      clearTimeout(t);
      window.removeEventListener('pointerdown', load);
    };
  }, [sample]);

  // Waveform zeichnen
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth * dpr;
    const h = cv.clientHeight * dpr;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    const n = peaks.length;
    const bw = w / n;
    const mid = h / 2;
    const progress = playing && !pendingStop ? beatPhase : -1;
    for (let i = 0; i < n; i++) {
      const amp = Math.max(0.06, peaks[i]);
      const played = progress >= 0 && i / n <= progress;
      g.fillStyle = played ? '#ffffff' : color;
      g.globalAlpha = played ? 0.95 : active ? 0.85 : 0.45;
      const bh = amp * (h * 0.78);
      g.fillRect(i * bw + bw * 0.18, mid - bh / 2, bw * 0.64, bh);
    }
    g.globalAlpha = 1;
  }, [peaks, color, active, playing, pendingStop, beatPhase]);

  const pulse = playing && !pendingStop ? 0.72 + 0.28 * Math.max(0, 1 - beatPhase * 3) : undefined;

  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onTrigger();
      }}
      className={cn(
        'group relative aspect-square select-none overflow-hidden rounded-xl border text-left',
        'transition-transform duration-75 active:scale-95 touch-none',
        active ? 'border-transparent' : 'border-white/10 bg-zinc-900/80 hover:border-white/25',
      )}
      style={
        active
          ? {
              background: `linear-gradient(160deg, ${color}40, #09090b 70%)`,
              boxShadow: `0 0 ${playing ? 26 * (pulse ?? 1) : 16}px ${color}77, inset 0 0 0 1px ${color}aa`,
              opacity: pendingStop ? 0.5 : 1,
            }
          : suggested
            ? { borderColor: color, boxShadow: `0 0 14px ${color}66`, animation: 'pad-suggest 1.2s ease-in-out infinite' }
            : undefined
      }
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Tipp-Badge der KI */}
      {suggested && !active && (
        <div
          className="absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-black"
          style={{ background: color }}
        >
          Tipp
        </div>
      )}

      {/* Typ-Icon */}
      <div className="absolute right-1.5 top-1.5 opacity-70">
        {sample.type === 'loop' ? (
          <Repeat className="h-3 w-3" style={{ color: active ? '#fff' : color }} />
        ) : (
          <Zap className="h-3 w-3" style={{ color: active ? '#fff' : color }} />
        )}
      </div>

      {/* Name */}
      <div className="absolute inset-x-1.5 bottom-1">
        <div
          className={cn('truncate text-[10px] font-semibold leading-tight sm:text-[11px]', active ? 'text-white' : 'text-zinc-300')}
          title={sample.name}
        >
          {sample.name}
        </div>
        <div className={cn('text-[9px]', active ? 'text-white/60' : 'text-zinc-500')}>
          {sample.type === 'loop' ? (sample.bpm ? `${sample.bpm} BPM` : 'Loop') : 'One-Shot'}
          {hotkey ? ` · ${hotkey}` : ''}
        </div>
      </div>
    </button>
  );
}
