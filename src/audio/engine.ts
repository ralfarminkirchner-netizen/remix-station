export type SampleType = 'loop' | 'oneshot';

export interface SampleDef {
  id: string;
  name: string;
  url: string;
  type: SampleType;
  bpm: number | null;
  category: string;
}

export interface PackDef {
  name: string;
  color: string;
  samples: SampleDef[];
}

export interface Manifest {
  generatedAt: string;
  packs: PackDef[];
}

interface ActiveLoop {
  src: AudioBufferSourceNode;
  gain: GainNode;
  sample: SampleDef;
  startedAt: number;
  pendingStopAt: number | null;
}

type Listener = () => void;

/**
 * Remixlive-artige Engine:
 * - Loops starten/stoppen immer exakt an der nächsten Taktgrenze
 * - Loops mit bekannter BPM werden per playbackRate an das globale Tempo angepasst
 * - One-Shots feuern sofort
 * - Globaler Lowpass-Filter + Master-Gain
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private loops = new Map<string, ActiveLoop>();
  private anchor: number | null = null; // AudioContext-Zeit von Takt 0
  bpm = 120;

  private listeners = new Set<Listener>();
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000;
      this.filter.Q.value = 0.4;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.filter.connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  get ready() {
    return this.ctx !== null;
  }

  private load(url: string): Promise<AudioBuffer> {
    let p = this.buffers.get(url);
    if (!p) {
      p = (async () => {
        const ctx = await this.ensure();
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
        return ctx.decodeAudioData(await res.arrayBuffer());
      })();
      this.buffers.set(url, p);
      p.catch(() => this.buffers.delete(url));
    }
    return p;
  }

  preload(samples: SampleDef[]) {
    samples.forEach((s) => void this.load(s.url).catch(() => {}));
  }

  // ---------- Transport ----------

  get barDuration(): number {
    return (4 * 60) / this.bpm;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Nächste Taktgrenze ab `from` (kleiner Offset, damit Scheduling sicher klappt). */
  nextBar(from?: number): number {
    const t = (from ?? this.now) + 0.02;
    if (this.anchor === null) return t;
    const bar = this.barDuration;
    const k = Math.ceil((t - this.anchor) / bar - 1e-6);
    return this.anchor + Math.max(k, 0) * bar;
  }

  /** 0..1 Position im aktuellen Takt + Taktzahl für die UI. */
  transport(): { beatPhase: number; bar: number; running: boolean } {
    if (!this.ctx || this.anchor === null) return { beatPhase: 0, bar: 0, running: false };
    const bar = this.barDuration;
    const pos = Math.max(0, this.now - this.anchor);
    return { beatPhase: (pos % bar) / bar, bar: Math.floor(pos / bar), running: true };
  }

  setBpm(bpm: number) {
    bpm = Math.min(200, Math.max(60, Math.round(bpm)));
    if (bpm === this.bpm) return;
    // Anker so verschieben, dass die nächste Taktgrenze zeitlich gleich bleibt
    if (this.ctx && this.anchor !== null) {
      const boundary = this.nextBar();
      const bar = (4 * 60) / bpm;
      this.anchor = boundary - Math.round((boundary - this.anchor) / this.barDuration) * bar;
    }
    this.bpm = bpm;
    // Laufende Loops ans neue Tempo anpassen
    for (const l of this.loops.values()) {
      if (l.sample.bpm) l.src.playbackRate.value = bpm / l.sample.bpm;
    }
    this.emit();
  }

  // ---------- Pads ----------

  isPlaying(id: string): boolean {
    return this.loops.has(id);
  }

  isPendingStop(id: string): boolean {
    return this.loops.get(id)?.pendingStopAt !== null && this.loops.get(id)?.pendingStopAt !== undefined;
  }

  async trigger(sample: SampleDef): Promise<void> {
    const ctx = await this.ensure();
    const buffer = await this.load(sample.url);

    if (sample.type === 'oneshot') {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      src.connect(g).connect(this.filter!);
      src.start();
      this.emit();
      return;
    }

    // Loop: Toggle
    const active = this.loops.get(sample.id);
    if (active) {
      if (active.pendingStopAt !== null) {
        // Stop zurücknehmen → weiterlaufen lassen
        active.src.onended = null;
        active.src.stop();
        // Quelle ist nach stop() verbraucht → neu starten, nahtlos ab Taktposition
        this.startLoop(sample, buffer, active.startedAt);
      } else {
        const stopAt = this.nextBar();
        active.pendingStopAt = stopAt;
        active.src.stop(stopAt);
        active.src.onended = () => {
          if (this.loops.get(sample.id) === active) {
            this.loops.delete(sample.id);
            this.emit();
          }
        };
      }
      this.emit();
      return;
    }

    if (this.anchor === null) this.anchor = ctx.currentTime + 0.05;
    this.startLoop(sample, buffer, this.nextBar());
  }

  private startLoop(sample: SampleDef, buffer: AudioBuffer, startAt: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (sample.bpm) src.playbackRate.value = this.bpm / sample.bpm;
    const g = ctx.createGain();
    src.connect(g).connect(this.filter!);
    src.start(startAt);
    this.loops.set(sample.id, { src, gain: g, sample, startedAt: startAt, pendingStopAt: null });
    this.emit();
  }

  stopAllLoops() {
    const stopAt = this.anchor === null ? this.now : this.nextBar();
    for (const [id, l] of this.loops) {
      if (l.pendingStopAt !== null) continue;
      l.pendingStopAt = stopAt;
      try {
        l.src.stop(stopAt);
      } catch {
        /* bereits gestoppt */
      }
      const active = l;
      l.src.onended = () => {
        if (this.loops.get(id) === active) {
          this.loops.delete(id);
          this.emit();
        }
      };
    }
    this.emit();
  }

  panicStop() {
    for (const l of this.loops.values()) {
      try {
        l.src.onended = null;
        l.src.stop();
      } catch {
        /* ignore */
      }
    }
    this.loops.clear();
    this.anchor = null;
    this.emit();
  }

  // ---------- Master ----------

  setMasterVolume(v: number) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.02);
  }

  /** norm: 0 (geschlossen, dumpf) … 1 (offen) */
  setFilter(norm: number) {
    if (!this.filter) return;
    const freq = 80 * Math.pow(20000 / 80, Math.min(1, Math.max(0, norm)));
    this.filter.frequency.setTargetAtTime(freq, this.now, 0.02);
  }
}

export const engine = new AudioEngine();
