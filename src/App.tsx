import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc3, FolderOpen, Square } from 'lucide-react';
import manifest from '@/generated/soundbank.json';
import { engine, type Manifest, type SampleDef } from '@/audio/engine';
import { arrangement, buildScenes, conflictsFor, suggest } from '@/audio/assistant';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { PadButton } from '@/components/PadButton';
import { TransportBar } from '@/components/TransportBar';
import { FXStrip } from '@/components/FXStrip';
import { AssistantPanel } from '@/components/AssistantPanel';
import { cn } from '@/lib/utils';

const data = manifest as Manifest;
const HOTKEYS = '1234567890qwertzuiopasdfghjklyxcvbnm'.split('');
const SCENE_BARS = 8;
const COLS = 6;

export default function App() {
  const [packName, setPackName] = useState(data.packs[0]?.name ?? '');
  const pack = data.packs.find((p) => p.name === packName) ?? data.packs[0];

  const [level, setLevel] = useState(50);
  const [energy, setEnergy] = useState(60);

  const allSamples = useMemo<SampleDef[]>(() => data.packs.flatMap((p) => p.samples), []);
  const {
    bpm, beatPhase, bar, transportRunning, playingIds, pendingStopIds, flashId,
    trigger, play, stop, setBpm, stopLoop, setMasterVolume, setFilter, setEcho, rollOn, rollOff,
  } = useAudioEngine(allSamples);

  const pads = useMemo(() => {
    if (!pack) return [];
    const loops = pack.samples.filter((s) => s.type === 'loop');
    const shots = pack.samples.filter((s) => s.type === 'oneshot');
    return [...loops, ...shots];
  }, [pack]);

  // ---------- KI-Assistenz ----------

  const scenes = useMemo(() => (pack ? buildScenes(pack) : []), [pack]);
  const curve = useMemo(() => arrangement(scenes, energy), [scenes, energy]);
  const sceneIdxRef = useRef(0);
  const lastChangeBarRef = useRef(-1);
  const [currentScene, setCurrentScene] = useState<string | null>(null);

  useEffect(() => {
    sceneIdxRef.current = 0;
    lastChangeBarRef.current = -1;
    setCurrentScene(null);
  }, [packName]);

  const applyScene = useCallback(
    (idx: number) => {
      if (!pack || curve.length === 0) return;
      const scene = curve[idx % curve.length];
      for (const s of pack.samples) {
        if (s.type !== 'loop') continue;
        const want = scene.ids.includes(s.id);
        const playing = engine.isPlaying(s.id);
        if (want && !playing) void engine.trigger(s);
        if (!want && playing && !engine.isPendingStop(s.id)) void engine.trigger(s);
      }
      setCurrentScene(scene.name);
      if (level >= 100) {
        const fx = pack.samples.find((s) => s.type === 'oneshot' && s.category === 'fx');
        if (fx) void engine.trigger(fx);
      }
    },
    [pack, curve, level],
  );

  useEffect(() => {
    if (level < 75 || !transportRunning || curve.length === 0) return;
    if (bar % SCENE_BARS === 0 && bar !== lastChangeBarRef.current) {
      lastChangeBarRef.current = bar;
      const next = lastChangeBarRef.current === 0 ? sceneIdxRef.current : sceneIdxRef.current + 1;
      sceneIdxRef.current = next % curve.length;
      applyScene(sceneIdxRef.current);
    }
  }, [bar, level, transportRunning, curve, applyScene]);

  useEffect(() => {
    if (level >= 100 && !transportRunning && curve.length > 0) {
      sceneIdxRef.current = 0;
      lastChangeBarRef.current = -1;
      applyScene(0);
    }
  }, [level, transportRunning, curve, applyScene]);

  const suggestedIds = useMemo(
    () => (level > 0 && pack ? suggest(pack, playingIds, energy) : []),
    [level, pack, playingIds, energy],
  );

  const smartTrigger = useCallback(
    async (s: SampleDef) => {
      if (level >= 50 && pack) {
        for (const id of conflictsFor(s, pack.samples, playingIds)) {
          const other = pack.samples.find((x) => x.id === id);
          if (other) await engine.trigger(other);
        }
      }
      await trigger(s);
    },
    [level, pack, playingIds, trigger],
  );

  // Spalten-Stop: alle Loops einer Grid-Spalte quantisiert stoppen
  const stopColumn = useCallback(
    (col: number) => {
      pads.forEach((s, i) => {
        if (i % COLS === col && engine.isPlaying(s.id)) stopLoop(s.id);
      });
    },
    [pads, stopLoop],
  );

  const columnHasPlaying = useCallback(
    (col: number) => pads.some((s, i) => i % COLS === col && playingIds.includes(s.id)),
    [pads, playingIds],
  );

  // Tastatur: Space = Play/Stop, Hotkeys = Pads
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        transportRunning ? stop() : void play();
        return;
      }
      const idx = HOTKEYS.indexOf(e.key.toLowerCase());
      if (idx >= 0 && idx < pads.length) void smartTrigger(pads[idx]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pads, smartTrigger, transportRunning, play, stop]);

  const barsToNext = level >= 75 && transportRunning ? SCENE_BARS - (bar % SCENE_BARS) : null;

  if (!pack) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-8 text-center text-zinc-300">
        <FolderOpen className="h-12 w-12 text-zinc-600" />
        <h1 className="text-xl font-bold">Soundbank ist leer</h1>
        <p className="max-w-md text-sm text-zinc-500">
          Audiodateien nach <code className="rounded bg-zinc-800 px-1.5 py-0.5">public/soundbank/</code> legen
          und <code className="rounded bg-zinc-800 px-1.5 py-0.5">npm run soundbank</code> ausführen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 [background-image:radial-gradient(ellipse_at_top,#1e1b4b40,transparent_55%)]">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-3 p-3 sm:p-4">
        {/* Kopfzeile kompakt */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-cyan-400">
              <Disc3 className={cn('h-5 w-5 text-white', transportRunning && 'animate-spin [animation-duration:1.8s]')} />
            </div>
            <h1 className="text-base font-black tracking-tight sm:text-lg">
              REMIX<span className="bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-transparent"> STATION</span>
              <span className="ml-2 hidden text-[10px] font-medium uppercase tracking-widest text-zinc-500 sm:inline">
                KI-Jam-Studio · AUDiOWERK
              </span>
            </h1>
          </div>
          <div className="text-[10px] text-zinc-500">
            {allSamples.length} Samples · {data.packs.length} Packs
          </div>
        </header>

        <TransportBar
          bpm={bpm}
          beatPhase={beatPhase}
          running={transportRunning}
          onPlay={() => void play()}
          onStop={stop}
          onBpm={setBpm}
          onVolume={setMasterVolume}
        />

        {/* Pack-Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {data.packs.map((p) => (
            <button
              key={p.name}
              onClick={() => setPackName(p.name)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                p.name === pack.name
                  ? 'border-transparent text-black'
                  : 'border-white/15 text-zinc-300 hover:border-white/40',
              )}
              style={p.name === pack.name ? { background: p.color } : undefined}
            >
              {p.name}
              <span className={cn('ml-1.5 text-[10px]', p.name === pack.name ? 'text-black/60' : 'text-zinc-500')}>
                {p.samples.length}
              </span>
            </button>
          ))}
        </div>

        {/* Pad-Grid + Spalten-Stops */}
        <div className="grid flex-1 grid-cols-6 content-start gap-2">
          {pads.map((s, i) => (
            <PadButton
              key={s.id}
              sample={s}
              playing={playingIds.includes(s.id)}
              pendingStop={pendingStopIds.includes(s.id)}
              flashed={flashId === s.id}
              beatPhase={beatPhase}
              hotkey={i < HOTKEYS.length ? HOTKEYS[i].toUpperCase() : undefined}
              suggested={suggestedIds.includes(s.id)}
              onTrigger={() => void smartTrigger(s)}
            />
          ))}
          {Array.from({ length: COLS }, (_, c) => (
            <button
              key={`stop-${c}`}
              onClick={() => stopColumn(c)}
              disabled={!columnHasPlaying(c)}
              className={cn(
                'flex h-7 items-center justify-center rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-colors',
                columnHasPlaying(c)
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/30'
                  : 'border-white/5 text-zinc-700',
              )}
            >
              <Square className="mr-1 h-2.5 w-2.5 fill-current" /> Stop
            </button>
          ))}
        </div>

        <FXStrip
          onFilter={setFilter}
          onEcho={setEcho}
          onRollStart={rollOn}
          onRollEnd={rollOff}
          enabled={transportRunning}
        />

        <AssistantPanel
          level={level}
          energy={energy}
          onLevel={setLevel}
          onEnergy={setEnergy}
          currentScene={currentScene}
          barsToNextChange={barsToNext}
        />
      </div>
    </div>
  );
}
