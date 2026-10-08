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
  buffer: AudioBuffer;
  startedAt: number;
  pendingStopAt: number | null;
  rolled: boolean;
}

type Listener = () => void;

/**
 * Remixlive-artige Engine:
 * - expliziter Transport (Play/Stop)
 * - Loops starten/stoppen exakt an Taktgrenzen
 * - Loops mit bekannter BPM folgen dem globalen Tempo (playbackRate)
 * - Echo-Bus (Feedback-Delay, dotted), Lowpass-Filter, Beat-Roll-FX
 * - Waveform-Peaks pro Sample für die Pad-Darstellung
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private echoInput: GainNode | null = null;
  private echoDelay: DelayNode | null = null;
  private echoFeedback: GainNode | null = null;

  private buffers = new Map<string, Promise<AudioBuffer>>();
  private peaksCache = new Map<string, Promise<Float32Array>>();
  private loops = new Map<string, ActiveLoop>();
  private anchor: number | null = null;
  private rolling = 0;
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
      this.filter.Q.value = 0.5;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.filter.connect(this.master);
      this.master.connect(this.ctx.destination);

      // Echo-Bus: Dotted-Eighth-Feedback-Delay
      this.echoInput = this.ctx.createGain();
      this.echoInput.gain.value = 0;
      this.echoDelay = this.ctx.createDelay(2);
      this.echoFeedback = this.ctx.createGain();
      this.echoFeedback.gain.value = 0.42;
      this.echoInput.connect(this.echoDelay);
      this.echoDelay.connect(this.echoFeedback);
      this.echoFeedback.connect(this.echoDelay);
      this.echoDelay.connect(this.filter);
      this.updateEchoTime();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  get ready() {
    return this.ctx !== null;
  }

  private updateEchoTime() {
    if (this.echoDelay) this.echoDelay.delayTime.value = (60 / this.bpm) * 0.75;
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

  /** Waveform-Peaks (0..1) für die Pad-Darstellung. */
  peaks(sample: SampleDef, count = 96): Promise<Float32Array> {
    let p = this.peaksCache.get(sample.id);
    if (!p) {
      p = this.load(sample.url).then((buf) => {
        const ch = buf.getChannelData(0);
        const block = Math.max(1, Math.floor(ch.length / count));
        const out = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          let max = 0;
          const off = i * block;
          for (let j = 0; j < block; j += 8) {
            const v = Math.abs(ch[off + j] || 0);
            if (v > max) max = v;
          }
          out[i] = max;
        }
        return out;
      });
      this.peaksCache.set(sample.id, p);
      p.catch(() => this.peaksCache.delete(sample.id));
    }
    return p;
  }

  // ---------- Transport ----------

  get barDuration(): number {
    return (4 * 60) / this.bpm;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  get isRunning(): boolean {
    return this.anchor !== null;
  }

  nextBar(from?: number): number {
    const t = (from ?? this.now) + 0.02;
    if (this.anchor === null) return t;
    const bar = this.barDuration;
    const k = Math.ceil((t - this.anchor) / bar - 1e-6);
    return this.anchor + Math.max(k, 0) * bar;
  }

  transport(): { beatPhase: number; bar: number; running: boolean } {
    if (!this.ctx || this.anchor === null) return { beatPhase: 0, bar: 0, running: false };
    const bar = this.barDuration;
    const pos = Math.max(0, this.now - this.anchor);
    return { beatPhase: (pos % bar) / bar, bar: Math.floor(pos / bar), running: true };
  }

  /** Play: Transport starten (auch ohne Loops – Takt läuft, Launches quantisieren sich). */
  async play() {
    const ctx = await this.ensure();
    if (this.anchor === null) this.anchor = ctx.currentTime + 0.08;
    this.emit();
  }

  /** Stop: alle Loops sofort aus, Transport anhalten. */
  stop() {
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
    this.rolling = 0;
    this.emit();
  }

  setBpm(bpm: number) {
    bpm = Math.min(200, Math.max(60, Math.round(bpm)));
    if (bpm === this.bpm) return;
    if (this.ctx && this.anchor !== null) {
      const boundary = this.nextBar();
      const bar = (4 * 60) / bpm;
      this.anchor = boundary - Math.round((boundary - this.anchor) / this.barDuration) * bar;
    }
    this.bpm = bpm;
    this.updateEchoTime();
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
    const l = this.loops.get(id);
    return l !== undefined && l.pendingStopAt !== null;
  }

  playingIds(): string[] {
    return [...this.loops.keys()];
  }

  async trigger(sample: SampleDef): Promise<void> {
    const ctx = await this.ensure();
    const buffer = await this.load(sample.url);

    if (sample.type === 'oneshot') {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      src.connect(g);
      g.connect(this.filter!);
      g.connect(this.echoInput!);
      src.start();
      this.emit();
      return;
    }

    const active = this.loops.get(sample.id);
    if (active) {
      if (active.pendingStopAt !== null) {
        // Stop zurücknehmen → nahtlos weiterlaufen
        active.src.onended = null;
        try {
          active.src.stop();
        } catch {
          /* ignore */
        }
        this.startLoop(sample, buffer, active.startedAt);
      } else {
        this.stopLoop(sample.id);
      }
      this.emit();
      return;
    }

    if (this.anchor === null) this.anchor = ctx.currentTime + 0.05;
    this.startLoop(sample, buffer, this.nextBar());
  }

  /** Quantisierter Stop eines einzelnen Loops (zur nächsten Taktgrenze). */
  stopLoop(id: string) {
    const active = this.loops.get(id);
    if (!active || active.pendingStopAt !== null) return;
    const stopAt = this.nextBar();
    active.pendingStopAt = stopAt;
    active.src.stop(stopAt);
    active.src.onended = () => {
      if (this.loops.get(id) === active) {
        this.loops.delete(id);
        this.emit();
      }
    };
    this.emit();
  }

  private startLoop(sample: SampleDef, buffer: AudioBuffer, startAt: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (sample.bpm) src.playbackRate.value = this.bpm / sample.bpm;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(this.filter!);
    g.connect(this.echoInput!);
    src.start(startAt);
    this.loops.set(sample.id, { src, gain: g, sample, buffer, startedAt: startAt, pendingStopAt: null, rolled: false });
    this.emit();
  }

  stopAllLoops() {
    for (const id of [...this.loops.keys()]) this.stopLoop(id);
  }

  // ---------- FX ----------

  setMasterVolume(v: number) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.02);
  }

  /** norm: 0 (dumpf) … 1 (offen) */
  setFilter(norm: number) {
    if (!this.filter) return;
    const freq = 80 * Math.pow(20000 / 80, Math.min(1, Math.max(0, norm)));
    this.filter.frequency.setTargetAtTime(freq, this.now, 0.02);
  }

  /** Echo-Anteil 0..1 */
  setEcho(norm: number) {
    if (this.echoInput) this.echoInput.gain.setTargetAtTime(norm * 0.7, this.now, 0.03);
  }

  /**
   * Beat-Roll: alle laufenden Loops wiederholen das aktuelle Slice
   * (fraction = Anteil eines Taktes, z. B. 1/4 oder 1/8). Momentary-FX.
   */
  rollOn(fraction: number) {
    if (!this.ctx || this.anchor === null) return;
    this.rolling += 1;
    const sliceLen = this.barDuration * fraction;
    for (const l of this.loops.values()) {
      if (l.pendingStopAt !== null) continue;
      const rate = l.src.playbackRate.value;
      const cycle = l.buffer.duration / rate; // Loop-Länge in Context-Sekunden
      const posInCycle = Math.max(0, (this.now - l.startedAt)) % cycle;
      const sliceStart = Math.floor(posInCycle / sliceLen) * sliceLen;
      l.src.loopStart = sliceStart * rate;
      l.src.loopEnd = Math.min((sliceStart + sliceLen) * rate, l.buffer.duration);
      l.rolled = true;
    }
    this.emit();
  }

  rollOff() {
    this.rolling = Math.max(0, this.rolling - 1);
    if (this.rolling > 0) return;
    for (const l of this.loops.values()) {
      if (!l.rolled) continue;
      l.src.loopStart = 0;
      l.src.loopEnd = l.buffer.duration;
      l.rolled = false;
    }
    this.emit();
  }

  get isRolling(): boolean {
    return this.rolling > 0;
  }
}

export const engine = new AudioEngine();
