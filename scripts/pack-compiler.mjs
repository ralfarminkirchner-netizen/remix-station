#!/usr/bin/env node
/**
 * Pack-Compiler: baut aus der AUDiOWERK/SAMPLE-CORE-Sammlung automatisch
 * tonart- und tempokompatible Packs in Remixlive-Logik.
 *
 * Pipeline:
 *   1. Kandidaten per Rollen-Keywords aus der API holen (max. ~3 MB, wav/mp3/ogg/flac)
 *   2. Download in .pack-cache/ (idempotent)
 *   3. Analyse mit essentia.js: BPM (PercivalBpmEstimator), Tonart (KeyExtractor),
 *      Energie, Dauer → Loop (>= 2 s) oder One-Shot
 *   4. Cluster: melodische Loops nach kompatibler Tonart (gleich / relativ / Quinte)
 *      und normalisiertem BPM (Halb-/Doppelzeit erlaubt, ±4)
 *   5. Packs zusammenstellen mit Rollen-Balance, nach public/soundbank/ kopieren
 *      (Loop-Dateien bekommen „… loop <bpm>bpm" im Namen → Scanner erkennt sie)
 *
 * Aufruf: node scripts/pack-compiler.mjs [--packs 5] [--max-files 350]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CACHE = join(root, '.pack-cache');
const OUT_BASE = join(root, 'public', 'soundbank');
const ANALYSIS_JSON = join(CACHE, 'analysis.json');

const args = process.argv.slice(2);
const argVal = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const API = argVal('api', process.env.AUDIOWERK_API || 'http://127.0.0.1:9096');
const FSROOT = argVal('root', null); // Direktzugriff-Modus: Verzeichnis statt API
const PACK_COUNT = Number(argVal('packs', 5));
const MAX_FILES = Number(argVal('max-files', 350));
const ROLE_CAP = Number(argVal('role-cap', 70)); // Kandidaten pro Rolle (FS-Modus)

const OK_EXT = new Set(['.wav', '.mp3', '.ogg', '.flac']);
const MAX_BYTES = 3 * 1024 * 1024;
const MIN_BYTES = 8000;

const ROLE_QUERIES = {
  drums: ['kick', 'snare', 'hat', 'clap', 'tom', 'ride', 'cymbal', 'drum'],
  perc: ['conga', 'djembe', 'bongo', 'shaker', 'tamb', 'perc', 'darabuka', 'timbales'],
  bass: ['bass', 'sub', '808', 'reese'],
  melody: ['synth', 'pad', 'piano', 'keys', 'organ', 'b3', 'clavinet', 'strings', 'viola', 'guitar', 'pluck', 'lead', 'arp', 'flute', 'marimba', 'bell'],
  vox: ['vox', 'vocal', 'choir', 'voice', 'chant'],
  fx: ['sfx', 'fx', 'riser', 'impact', 'sweep', 'glitch', 'gong', 'noise', 'whoosh'],
};

// Ziel-Zusammensetzung pro Pack (Remixlive-Logik, angepasst auf reale Fundlage)
const PACK_TARGET = {
  loop: { drums: 6, perc: 5, bass: 4, melody: 8, vox: 2, fx: 3 },
  oneshot: { drums: 10, perc: 6, bass: 2, melody: 6, vox: 2, fx: 4 },
};

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---------- essentia laden ----------
const mod = await import('essentia.js');
const Essentia = mod.Essentia ?? mod.default?.Essentia ?? mod.default;
const EssentiaWASM = mod.EssentiaWASM ?? mod.default?.EssentiaWASM;
const essentia = new Essentia(EssentiaWASM);
const decode = (await import('audio-decode')).default;

const cleanName = (name) =>
  name
    .replace(/^[0-9a-f]{12,}[_ ]/i, '') // Hash-Präfix
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b[0-9a-f]{8,}\b/gi, '') // eingebettete Hash-Fragmente
    .replace(/^(loop|loops|melodic|sound|sample)\s+/i, '') // generische Füllwörter
    .replace(/\s+/g, ' ')
    .trim();

// ---------- FS-Modus: Baum durchsuchen, Rolle per Keyword ----------
import { readdirSync, statSync } from 'node:fs';

function matchRole(baseName) {
  const n = baseName.toLowerCase();
  for (const [role, kws] of Object.entries(ROLE_QUERIES)) {
    for (const kw of kws) if (n.includes(kw)) return role;
  }
  return null;
}

function* walkAudio(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.startsWith('.') || e.startsWith('00-') || e.startsWith('99-')) continue;
    const full = join(dir, e);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // defekte Symlinks o. ä.
    }
    if (st.isDirectory()) yield* walkAudio(full, depth + 1);
    else if (OK_EXT.has(extname(e).toLowerCase()) && st.size >= MIN_BYTES && st.size <= MAX_BYTES) {
      yield { path: full, name: e, ext: extname(e).toLowerCase(), size: st.size };
    }
  }
}

/** Deterministisches Reservoir-Sampling, damit Packs reproduzierbar bleiben. */
function reservoir(items, cap, seed) {
  const rng = mulberry(seed);
  const out = [];
  let i = 0;
  for (const item of items) {
    i++;
    if (out.length < cap) out.push(item);
    else {
      const j = Math.floor(rng() * i);
      if (j < cap) out[j] = item;
    }
  }
  return out;
}

function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- API ----------
async function apiJson(path) {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${path}`);
  return res.json();
}

async function download(path, dest) {
  if (existsSync(dest)) return true;
  try {
    const res = await fetch(`${API}/sample-core/file?path=${encodeURIComponent(path)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return false;
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

// ---------- Analyse ----------
const analysis = existsSync(ANALYSIS_JSON)
  ? JSON.parse(readFileSync(ANALYSIS_JSON, 'utf8'))
  : {};

function normalizeBpm(bpm) {
  let b = bpm;
  while (b < 85) b *= 2;
  while (b >= 180) b /= 2;
  return b;
}

async function analyze(filePath) {
  const cached = analysis[filePath];
  if (cached && typeof cached.duration === 'number') return cached;
  try {
    const audio = await decode(readFileSync(filePath));
    let ch = audio.channelData[0];
    const sr = audio.sampleRate || 44100;
    // audio-decode liefert kein .duration → aus Frames + Samplerate rechnen
    const duration = (audio.length ?? ch.length) / sr;
    const maxLen = sr * 25; // max. 25 s analysieren
    if (ch.length > maxLen) ch = ch.slice(0, maxLen);
    const vec = essentia.arrayToVector(ch);
    let bpm = null;
    let key = null;
    let scale = null;
    let keyStrength = 0;
    try {
      const r = essentia.PercivalBpmEstimator(vec);
      if (r && r.bpm > 40 && r.bpm < 260) bpm = Math.round(r.bpm);
    } catch { /* Drums ohne klares Tempo */ }
    try {
      const k = essentia.KeyExtractor(vec);
      if (k && k.key) {
        key = k.key;
        scale = k.scale;
        keyStrength = k.strength ?? 0;
      }
    } catch { /* atonal */ }
    let energy = 0;
    try {
      energy = essentia.Energy(vec).energy;
    } catch { /* ignore */ }
    const out = { duration, bpm, key, scale, keyStrength, energy };
    analysis[filePath] = out;
    return out;
  } catch {
    analysis[filePath] = null;
    return null;
  }
}

// ---------- Tonart-Kompatibilität ----------
function keyCompatible(a, b) {
  if (!a.key || !b.key) return true; // atonale passen überall
  const pa = PC_NAMES.indexOf(a.key.replace('H', 'B'));
  const pb = PC_NAMES.indexOf(b.key.replace('H', 'B'));
  if (pa < 0 || pb < 0) return true;
  const diff = (pa - pb + 12) % 12;
  if (a.scale === b.scale) return diff === 0 || diff === 5 || diff === 7;
  // relativ Dur/Moll (3 bzw. 9 Halbtöne)
  return diff === 3 || diff === 9;
}

function bpmCompatible(a, b) {
  if (!a.bpm || !b.bpm) return true;
  return Math.abs(normalizeBpm(a.bpm) - normalizeBpm(b.bpm)) <= 4;
}

// ---------- Hauptprogramm ----------
console.log(`Pack-Compiler · ${FSROOT ? `FS ${FSROOT}` : `API ${API}`} · Ziel ${PACK_COUNT} Packs\n`);

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT_BASE, { recursive: true });

// 1. Kandidaten sammeln
const seen = new Set();
const candidates = []; // {role, path, name, ext, size, cacheFile}

if (FSROOT) {
  // Direktzugriff: Baum scannen, Rolle per Dateiname, Reservoir-Sampling pro Rolle
  const perRole = new Map(Object.keys(ROLE_QUERIES).map((r) => [r, []]));
  let scanned = 0;
  for (const f of walkAudio(FSROOT)) {
    scanned++;
    const base = cleanName(f.name);
    if (!base) continue;
    const role = matchRole(base);
    if (!role) continue;
    if (seen.has(base.toLowerCase())) continue;
    seen.add(base.toLowerCase());
    perRole.get(role).push({ role, path: f.path, name: base, ext: f.ext, size: f.size, cacheFile: f.path });
  }
  console.log(`Gescannt: ${scanned} Dateien`);
  let seed = 42;
  for (const [role, items] of perRole) {
    const picked = reservoir(items, ROLE_CAP, seed++);
    candidates.push(...picked);
    console.log(`  ${role}: ${items.length} Treffer → ${picked.length} Kandidaten`);
  }
} else {
  for (const [role, queries] of Object.entries(ROLE_QUERIES)) {
    for (const q of queries) {
      if (candidates.length >= MAX_FILES) break;
      let data;
      try {
        data = await apiJson(`/sample-core/list?q=${encodeURIComponent(q)}&limit=60`);
      } catch (e) {
        console.warn(`⚠ Suche ${q}: ${e.message}`);
        continue;
      }
      for (const f of data.files || []) {
        if (candidates.length >= MAX_FILES) break;
        if (!f.available || !OK_EXT.has(f.ext.toLowerCase())) continue;
        if (f.size < MIN_BYTES || f.size > MAX_BYTES) continue;
        const base = cleanName(f.name);
        if (!base || seen.has(base.toLowerCase())) continue;
        seen.add(base.toLowerCase());
        const cacheFile = join(CACHE, createHash('sha1').update(f.path).digest('hex') + f.ext.toLowerCase());
        candidates.push({ role, path: f.path, name: base, ext: f.ext.toLowerCase(), size: f.size, cacheFile });
      }
    }
  }
}
console.log(`Kandidaten: ${candidates.length}\n`);

// 2. Download (nur API-Modus) + Analyse
let done = 0;
for (const c of candidates) {
  if (!FSROOT && !(await download(c.path, c.cacheFile))) continue;
  const a = await analyze(c.cacheFile);
  if (!a) continue;
  c.analysis = a;
  c.kind = a.duration >= 1.8 ? 'loop' : 'oneshot';
  done++;
  if (done % 25 === 0) {
    writeFileSync(ANALYSIS_JSON, JSON.stringify(analysis));
    console.log(`  analysiert: ${done}/${candidates.length}`);
  }
}
writeFileSync(ANALYSIS_JSON, JSON.stringify(analysis));
const usable = candidates.filter((c) => c.analysis);
console.log(`\nAnalysiert & nutzbar: ${usable.length}`);

// ---------- Namens-Fallbacks: „…_130_02.wav“ = BPM, „…_Db5.wav“ = Ton ----------
const NOTE_PC = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11, H: 11 };

function nameBpm(name) {
  const m = name.match(/(?:^|\s)(\d{2,3})\s*(?:bpm)?(?:\s+\d{1,2})?$/i) || name.match(/_(\d{2,3})_\d{1,2}$/);
  if (!m) return null;
  const b = Number(m[1]);
  return b >= 60 && b <= 200 ? b : null;
}

function namePc(name) {
  const m = name.match(/(?:^|\s)([A-G][b#]?|H)(?:\s*\d)?(?:\s+\d{1,2})?$/);
  if (!m) return null;
  return NOTE_PC[m[1].toUpperCase()] ?? null;
}

const effBpm = (c) => c.analysis.bpm ?? nameBpm(c.name);
const MELODIC = new Set(['melody', 'bass', 'vox']);
const effPc = (c) => {
  if (MELODIC.has(c.role)) {
    if (c.analysis.key && (c.analysis.keyStrength ?? 0) > 0.45) {
      const pc = NOTE_PC[c.analysis.key.toUpperCase().replace('H', 'B')];
      if (pc !== undefined) return pc;
    }
    return namePc(c.name);
  }
  return null;
};

// ---------- Skalen ----------
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const inScale = (pc, packPc, mode) => SCALES[mode].includes((pc - packPc + 12) % 12);

// ---------- 3. BPM-Cluster der Loops ----------
const loops = usable.filter((c) => c.kind === 'loop' && effBpm(c));
const bpmClusters = [];
for (const c of loops.sort((a, b) => effBpm(a) - effBpm(b))) {
  const hit = bpmClusters.find((cl) => Math.abs(normalizeBpm(effBpm(c)) - cl.bpm) <= 4);
  if (hit) hit.members.push(c);
  else bpmClusters.push({ bpm: normalizeBpm(effBpm(c)), members: [c] });
}
bpmClusters.sort((a, b) => b.members.length - a.members.length);
console.log(`Loops mit BPM: ${loops.length} → ${bpmClusters.length} Tempo-Cluster (größtes: ${bpmClusters[0]?.members.length ?? 0})`);

// ---------- 4. Packs füllen ----------
const used = new Set();
const takeFree = (pool, n) => {
  const out = [];
  for (const c of pool) {
    if (out.length >= n) break;
    if (used.has(c.path)) continue;
    used.add(c.path);
    out.push(c);
  }
  return out;
};

let packNo = 0;
for (const cluster of bpmClusters) {
  if (packNo >= PACK_COUNT) break;
  const bpmLabel = cluster.bpm.toFixed(0);
  const packFiles = [];
  let packKey = null; // {pc, mode}

  // a) Melodische Loops: erstes mit sicherer Tonart setzt den Pack-Key, Rest muss passen
  const meloLoops = cluster.members.filter(
    (c) => MELODIC.has(c.role) && !used.has(c.path) && effPc(c) !== null && (c.analysis.keyStrength ?? 0) > 0.5,
  );
  for (const c of meloLoops) {
    if (packFiles.filter((p) => MELODIC.has(p.role)).length >= PACK_TARGET.loop.melody + PACK_TARGET.loop.bass + PACK_TARGET.loop.vox) break;
    const pc = effPc(c);
    const mode = c.analysis.scale === 'minor' ? 'minor' : 'major';
    if (!packKey) packKey = { pc, mode };
    const compat =
      inScale(pc, packKey.pc, packKey.mode) || // Tonika der anderen Tonart in Skala
      keyCompatible({ key: PC_NAMES[pc], scale: mode }, { key: PC_NAMES[packKey.pc], scale: packKey.mode });
    if (!compat) continue;
    used.add(c.path);
    packFiles.push(c);
  }

  // b) Rhythmische Loops (atonale passen immer, nur BPM-Match im Cluster)
  for (const [role, n] of Object.entries({ drums: PACK_TARGET.loop.drums, perc: PACK_TARGET.loop.perc, fx: PACK_TARGET.loop.fx })) {
    packFiles.push(...takeFree(cluster.members.filter((c) => c.role === role), n));
  }

  // c) Falls kein Pack-Key aus Loops: häufigster melodischer One-Shot-PC bestimmt ihn
  if (!packKey) {
    const counts = new Map();
    for (const c of usable) {
      if (c.kind !== 'oneshot' || !MELODIC.has(c.role) || used.has(c.path)) continue;
      const pc = effPc(c);
      if (pc !== null) counts.set(pc, (counts.get(pc) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) packKey = { pc: top[0], mode: 'minor' }; // moll = poppiger Default
  }

  // d) One-Shots: rhythmisch frei, melodisch nur in Skala
  for (const [role, n] of Object.entries(PACK_TARGET.oneshot)) {
    const pool = usable.filter((c) => c.kind === 'oneshot' && c.role === role && !used.has(c.path));
    if (MELODIC.has(role) && packKey) {
      packFiles.push(...takeFree(pool.filter((c) => { const pc = effPc(c); return pc !== null && inScale(pc, packKey.pc, packKey.mode); }), n));
    } else {
      packFiles.push(...takeFree(pool, n));
    }
  }

  if (packFiles.length < 18) {
    console.log(`  ↷ ${bpmLabel} BPM: nur ${packFiles.length} Files – übersprungen`);
    continue;
  }

  const keyLabel = packKey ? `${PC_NAMES[packKey.pc]} ${packKey.mode === 'minor' ? 'moll' : 'dur'}` : 'frei';
  const packName = `Pack ${String(packNo + 1).padStart(2, '0')} · ${keyLabel} · ${bpmLabel}`;
  const packDir = join(OUT_BASE, packName);

  mkdirSync(packDir, { recursive: true });
  const meta = { key: packKey ? PC_NAMES[packKey.pc] : null, mode: packKey?.mode ?? null, bpmNorm: Number(bpmLabel), files: [] };
  for (const f of packFiles) {
    const b = effBpm(f);
    const bpmTag = f.kind === 'loop' && b ? ` ${b}bpm loop` : f.kind === 'loop' ? ' loop' : '';
    const outName = `${f.name}${bpmTag}${f.ext}`.replace(/\s+/g, ' ').trim();
    copyFileSync(f.cacheFile, join(packDir, outName));
    meta.files.push({ file: outName, role: f.role, kind: f.kind, bpm: b ?? null, pc: effPc(f) });
  }
  writeFileSync(join(packDir, 'pack.json'), JSON.stringify(meta, null, 2));
  packNo++;
  console.log(`  ✔ ${packName}: ${packFiles.length} Files`);
}

console.log(`\nFertig: ${packNo} Pack(s) gebaut. Jetzt: npm run soundbank`);
