import { useCallback, useEffect, useRef, useState } from 'react';
import { engine, type SampleDef } from '@/audio/engine';

interface EngineState {
  bpm: number;
  playingIds: string[];
  pendingStopIds: string[];
}

/** Koppelt die AudioEngine an React-State + Beat-Clock (rAF). */
export function useAudioEngine(manifestSamples: SampleDef[]) {
  const [, force] = useState(0);
  const [beatPhase, setBeatPhase] = useState(0);
  const [bar, setBar] = useState(0);
  const [transportRunning, setTransportRunning] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<number>(0);

  useEffect(() => engine.subscribe(() => force((n) => n + 1)), []);

  // Samples schon mal dekodieren, sobald der erste User-Gesture den Context erlaubt
  useEffect(() => {
    const warm = () => engine.preload(manifestSamples);
    window.addEventListener('pointerdown', warm, { once: true });
    return () => window.removeEventListener('pointerdown', warm);
  }, [manifestSamples]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = engine.transport();
      setBeatPhase(t.beatPhase);
      setBar(t.bar);
      setTransportRunning(t.running);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const trigger = useCallback(async (s: SampleDef) => {
    await engine.trigger(s);
    if (s.type === 'oneshot') {
      setFlashId(s.id);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashId(null), 220);
    }
  }, []);

  const state: EngineState = {
    bpm: engine.bpm,
    playingIds: manifestSamples.filter((s) => engine.isPlaying(s.id)).map((s) => s.id),
    pendingStopIds: manifestSamples.filter((s) => engine.isPendingStop(s.id)).map((s) => s.id),
  };

  return {
    ...state,
    beatPhase,
    bar,
    transportRunning,
    flashId,
    trigger,
    setBpm: (b: number) => engine.setBpm(b),
    stopAllLoops: () => engine.stopAllLoops(),
    panicStop: () => engine.panicStop(),
    setMasterVolume: (v: number) => engine.setMasterVolume(v),
    setFilter: (n: number) => engine.setFilter(n),
  };
}
