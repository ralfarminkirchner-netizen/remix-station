import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Disc3, FolderOpen } from 'lucide-react';
import manifest from '@/generated/soundbank.json';
import { engine, type Manifest, type SampleDef } from '@/audio/engine';
import { arrangement, buildScenes, conflictsFor, suggest } from '@/audio/assistant';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { PadButton } from '@/components/PadButton';
import { TransportBar } from '@/components/TransportBar';
import { AssistantPanel } from '@/components/AssistantPanel';
import { cn } from '@/lib/utils';

const data = manifest as Manifest;
const HOTKEYS = '1234567890qwertzuiopasdfghjklyxcvbnm'.split('');
const SCENE_BARS = 8; // Auto-Arrangement wechselt alle 8 Takte

export default function App() {
  const [packName, setPackName] = useState(data.packs[0]?.name ?? '');
  const pack = data.packs.find((p) => p.name === packName) ?? data.packs[0];

  const [level, setLevel] = useState(50); // KI-Assistenz in %
  const [energy, setEnergy] = useState(60); // Energie in %

  const allSamples = useMemo<SampleDef[]>(() => data.packs.flatMap((p) => p.samples), []);
  const {
    bpm, beatPhase, bar, transportRunning, playingIds, pendingStopIds, flashId,
    trigger, setBpm, stopAllLoops, panicStop, setMasterVolume, setFilter,
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
      // Autopilot: FX-One-Shot zum Szenenwechsel
      if (level >= 100) {
        const fx = pack.samples.find((s) => s.type === 'oneshot' && s.category === 'fx');
        if (fx) void engine.trigger(fx);
      }
    },
    [pack, curve, level],
  );

  // Arrangeur/Autopilot: Szenenwechsel an Taktgrenzen
  useEffect(() => {
    if (level < 75 || !transportRunning || curve.length === 0) return;
    if (bar % SCENE_BARS === 0 && bar !== lastChangeBarRef.current) {
      lastChangeBarRef.current = bar;
      const next = lastChangeBarRef.current === 0 ? sceneIdxRef.current : sceneIdxRef.current + 1;
      sceneIdxRef.current = next % curve.length;
      applyScene(sceneIdxRef.current);
    }
  }, [bar, level, transportRunning, curve, applyScene]);

  // Autopilot: von selbst loslegen, sobald aktiviert
  useEffect(() => {
    if (level >= 100 && !transportRunning && curve.length > 0) {
      sceneIdxRef.current = 0;
      lastChangeBarRef.current = -1;
      applyScene(0);
    }
  }, [level, transportRunning, curve, applyScene]);

  // Pad-Vorschläge
  const suggestedIds = useMemo(
    () => (level > 0 && pack ? suggest(pack, playingIds, energy) : []),
    [level, pack, playingIds, energy],
  );

  // Co-Pilot: unpassende Kombis aufräumen, dann triggern
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

  // Tastatur-Steuerung
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = HOTKEYS.indexOf(e.key.toLowerCase());
      if (idx >= 0 && idx < pads.length) void smartTrigger(pads[idx]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pads, smartTrigger]);

  const barsToNext =
    level >= 75 && transportRunning ? SCENE_BARS - (bar % SCENE_BARS) : null;

  if (!pack) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-8 text-center text-zinc-300">
        <FolderOpen className="h-12 w-12 text-zinc-600" />
        <h1 className="text-xl font-bold">Soundbank ist leer</h1>
        <p className="max-w-md text-sm text-zinc-500">
          Lege Audiodateien (wav, mp3, ogg …) in <code className="rounded bg-zinc-800 px-1.5 py-0.5">public/soundbank/</code> ab
          – jeder Unterordner wird ein Pack – und führe danach <code className="rounded bg-zinc-800 px-1.5 py-0.5">npm run soundbank</code> aus.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 [background-image:radial-gradient(ellipse_at_top,#1e1b4b33,transparent_60%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
        {/* Kopfzeile */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-cyan-400">
              <Disc3 className={cn('h-6 w-6 text-white', transportRunning && 'animate-spin [animation-duration:1.8s]')} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight sm:text-xl">
                REMIX<span className="bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-transparent"> STATION</span>
              </h1>
              <p className="text-[11px] uppercase tracking-widest text-zinc-500">KI-Jam-Studio · jeder kann mitspielen</p>
            </div>
          </div>
          <div className="hidden text-right text-[11px] text-zinc-500 sm:block">
            <div>{data.packs.length} Pack(s) · {allSamples.length} Samples</div>
            <div>Loops starten/stoppen quantisiert zum Takt</div>
          </div>
        </header>

        <AssistantPanel
          level={level}
          energy={energy}
          onLevel={setLevel}
          onEnergy={setEnergy}
          currentScene={currentScene}
          barsToNextChange={barsToNext}
        />

        <TransportBar
          bpm={bpm}
          beatPhase={beatPhase}
          transportRunning={transportRunning}
          onBpm={setBpm}
          onStopAll={stopAllLoops}
          onPanic={panicStop}
          onVolume={setMasterVolume}
          onFilter={setFilter}
        />

        {/* Pack-Tabs */}
        {data.packs.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {data.packs.map((p) => (
              <button
                key={p.name}
                onClick={() => setPackName(p.name)}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors',
                  p.name === pack.name
                    ? 'border-transparent text-black'
                    : 'border-white/15 text-zinc-300 hover:border-white/40',
                )}
                style={p.name === pack.name ? { background: p.color } : undefined}
              >
                {p.name}
                <span className={cn('ml-2 text-xs', p.name === pack.name ? 'text-black/60' : 'text-zinc-500')}>
                  {p.samples.length}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Pad-Grid */}
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-7">
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
        </div>

        <footer className="pb-2 text-center text-[11px] text-zinc-600">
          Eigene Samples: Ordner nach <code className="rounded bg-zinc-900 px-1">public/soundbank/</code> kopieren oder verlinken,
          dann <code className="rounded bg-zinc-900 px-1">npm run soundbank</code>. Dateiname mit „loop“ + „120bpm“ wird als quantisierter Loop erkannt.
        </footer>
      </div>
    </div>
  );
}
