import type { PackDef, SampleDef } from './engine';

/**
 * AssistantBrain – die „KI“ hinter dem Assistenz-Regler.
 *
 * Regelbasierte Musik-Intelligenz für den Live-Einsatz:
 * - kennt die Rolle jedes Loops (Kick, Hats, Snare, Bass, Melodie, Perc, FX)
 * - baut daraus Szenen (Intro, Groove, Full, Peak, Break), die musikalisch
 *   immer zusammenpassen
 * - schlägt passende nächste Pads vor
 * - verhindert auf höheren Stufen unmusikalische Kombis (z. B. zwei Basslines)
 * - arrangiert auf höchsten Stufen den Songverlauf selbstständig
 */

export interface SceneDef {
  name: string;
  ids: string[];
  intensity: number; // 0..100
}

export interface LoopRoles {
  kick?: SampleDef;
  hats?: SampleDef;
  snare?: SampleDef;
  bass?: SampleDef;
  melody?: SampleDef;
  perc?: SampleDef;
  fx?: SampleDef;
  rest: SampleDef[];
}

const pick = (loops: SampleDef[], re: RegExp) => loops.find((s) => re.test(s.name.toLowerCase()));

export function analyzePack(pack: PackDef): LoopRoles {
  const loops = pack.samples.filter((s) => s.type === 'loop');
  const roles: LoopRoles = {
    kick: pick(loops, /kick|bd|bassdrum/),
    hats: pick(loops, /hat|hh|shaker/),
    snare: pick(loops, /snare|clap/),
    bass: pick(loops, /bass|sub|808/),
    melody: pick(loops, /pad|chord|keys|synth|lead|arp|melo|pluck/),
    perc: pick(loops, /perc|tom|conga/),
    fx: pick(loops, /fx|riser|sweep/),
    rest: [],
  };
  const used = new Set(
    [roles.kick, roles.hats, roles.snare, roles.bass, roles.melody, roles.perc, roles.fx]
      .filter(Boolean)
      .map((s) => s!.id),
  );
  roles.rest = loops.filter((s) => !used.has(s.id));
  return roles;
}

const ids = (...ss: (SampleDef | undefined)[]) => ss.filter(Boolean).map((s) => s!.id);

/** Szenen-Kanon: von ruhig nach dicht. */
export function buildScenes(pack: PackDef): SceneDef[] {
  const r = analyzePack(pack);
  const scenes: SceneDef[] = [];

  const intro = ids(r.melody, r.perc);
  const groove = ids(r.kick, r.hats, r.bass);
  const full = ids(r.kick, r.hats, r.snare, r.bass, r.melody);
  const peak = [...full, ...ids(r.perc, r.fx)];
  const brk = ids(r.melody, r.perc);

  if (intro.length) scenes.push({ name: 'Intro', ids: intro, intensity: 25 });
  if (groove.length) scenes.push({ name: 'Groove', ids: groove, intensity: 50 });
  if (full.length) scenes.push({ name: 'Full', ids: full, intensity: 75 });
  if (peak.length > full.length) scenes.push({ name: 'Peak', ids: peak, intensity: 95 });
  if (brk.length) scenes.push({ name: 'Break', ids: brk, intensity: 15 });
  return scenes;
}

/** Typischer Songverlauf; wird je nach Energie gefiltert. */
export function arrangement(scenes: SceneDef[], energy: number): SceneDef[] {
  const byName = (n: string) => scenes.find((s) => s.name === n);
  const curve = ['Intro', 'Groove', 'Full', 'Break', 'Groove', 'Peak', 'Break', 'Full']
    .map(byName)
    .filter((s): s is SceneDef => !!s);
  if (curve.length === 0) return scenes;
  if (energy < 33) return curve.filter((s) => s.intensity <= 50);
  if (energy < 66) return curve.filter((s) => s.intensity <= 75);
  return curve;
}

/**
 * Vorschläge: welche Loops passen jetzt als Nächstes?
 * Priorität: fehlende Grundbausteine zuerst (Kick → Bass → Hats → Snare → Melodie).
 */
export function suggest(pack: PackDef, playingIds: string[], energy: number): string[] {
  const r = analyzePack(pack);
  const playing = new Set(playingIds);
  const order = [r.kick, r.bass, r.hats, r.snare, r.melody, r.perc].filter(
    (s): s is SampleDef => !!s,
  );
  const missing = order.filter((s) => !playing.has(s.id));
  const maxNew = energy < 33 ? 1 : energy < 66 ? 2 : 3;
  return missing.slice(0, maxNew).map((s) => s.id);
}

/**
 * Co-Pilot-Regel: gibt Loop-IDs zurück, die gestoppt werden sollten,
 * damit `sample` sauber einsetzen kann (max. 1 Loop pro Bass-/Melodie-Rolle).
 */
export function conflictsFor(
  sample: SampleDef,
  loops: SampleDef[],
  playingIds: string[],
): string[] {
  if (sample.type !== 'loop') return [];
  const guardCats = new Set(['bass', 'melody', 'vox']);
  if (!guardCats.has(sample.category)) return [];
  const playing = new Set(playingIds);
  return loops
    .filter((s) => s.type === 'loop' && s.category === sample.category && s.id !== sample.id && playing.has(s.id))
    .map((s) => s.id);
}

/** Assistenz-Stufen-Beschreibung für die UI. */
export function levelInfo(level: number): { title: string; desc: string } {
  if (level <= 0)
    return { title: 'Aus', desc: 'Alles manuell – volle Freiheit, volles Risiko.' };
  if (level < 50)
    return { title: 'Tipps', desc: 'Passende Pads leuchten auf – du entscheidest.' };
  if (level < 75)
    return { title: 'Co-Pilot', desc: 'Tipps + die KI räumt klingende Kombis auf: pro Bass-/Melodie-Rolle läuft immer nur ein Loop.' };
  if (level < 100)
    return { title: 'Arrangeur', desc: 'Die KI baut den Songverlauf (Intro → Groove → Peak → Break) und wechselt alle 8 Takte die Szene. Du jamst darüber.' };
  return { title: 'Autopilot', desc: 'Die KI jammt komplett selbst – du kannst jederzeit Pads übernehmen oder drehen.' };
}
