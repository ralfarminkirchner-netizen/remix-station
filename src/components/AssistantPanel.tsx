import { Sparkles, Flame, ChevronRight } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { levelInfo } from '@/audio/assistant';
import { cn } from '@/lib/utils';

interface AssistantPanelProps {
  level: number;
  energy: number;
  onLevel: (v: number) => void;
  onEnergy: (v: number) => void;
  currentScene: string | null;
  barsToNextChange: number | null;
}

export function AssistantPanel({
  level, energy, onLevel, onEnergy, currentScene, barsToNextChange,
}: AssistantPanelProps) {
  const info = levelInfo(level);
  const active = level > 0;

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 backdrop-blur transition-colors',
        active
          ? 'border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-950/60 via-zinc-900/70 to-cyan-950/50'
          : 'border-white/10 bg-zinc-900/70',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        {/* KI-Assistenz */}
        <div className="min-w-56 flex-1">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className={cn('h-4 w-4', active ? 'text-fuchsia-400' : 'text-zinc-500')} />
              <span className="text-sm font-bold">KI-Assistenz</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  active ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-zinc-800 text-zinc-500',
                )}
              >
                {info.title}
              </span>
            </div>
            <span className="text-sm font-black tabular-nums text-fuchsia-300">{level}%</span>
          </div>
          <Slider
            value={[level]}
            max={100}
            step={1}
            onValueChange={([v]) => onLevel(v)}
            className="[&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-fuchsia-500 [&_[data-slot=slider-range]]:to-cyan-400"
          />
          <p className="mt-2 text-xs leading-snug text-zinc-400">{info.desc}</p>
        </div>

        {/* Energie */}
        <div className="min-w-40 flex-1">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className={cn('h-4 w-4', energy > 66 ? 'text-orange-400' : 'text-zinc-500')} />
              <span className="text-sm font-bold">Energie</span>
            </div>
            <span className="text-sm font-black tabular-nums text-orange-300">{energy}%</span>
          </div>
          <Slider
            value={[energy]}
            max={100}
            step={1}
            onValueChange={([v]) => onEnergy(v)}
            className="[&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-amber-500 [&_[data-slot=slider-range]]:to-orange-500"
          />
          <p className="mt-2 text-xs leading-snug text-zinc-400">
            Wie dicht die Vorschläge und das Auto-Arrangement werden.
          </p>
        </div>

        {/* Szenen-Status */}
        {level >= 75 && (
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">Szene</div>
              <div className="text-sm font-bold text-cyan-300">{currentScene ?? '–'}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-zinc-600" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500">Wechsel in</div>
              <div className="text-sm font-bold tabular-nums text-zinc-200">
                {barsToNextChange !== null ? `${barsToNextChange} Takte` : '–'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
