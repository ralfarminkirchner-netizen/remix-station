#!/usr/bin/env node
/**
 * Soundbank-Scanner
 * -----------------
 * Durchsucht public/soundbank/ rekursiv nach Audiodateien und schreibt
 * src/generated/soundbank.json – das Manifest, das die App beim Start lädt.
 *
 * Konventionen:
 *   - Jeder Unterordner von public/soundbank/ wird ein "Pack".
 *   - Dateiname enthält "loop"  → Loop-Pad (wird zum Beat quantisiert)
 *   - Dateiname enthält "120bpm"/"bpm120" → Original-BPM des Loops
 *   - Alles andere → One-Shot-Pad (feuert sofort)
 *
 * Eigene Soundbank anbinden: Ordner nach public/soundbank/ kopieren oder
 * einen Symlink dorthin legen, dann `npm run soundbank`.
 */
import { readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOUNDBANK_DIR = join(root, 'public', 'soundbank');
const OUT_DIR = join(root, 'src', 'generated');
const OUT_FILE = join(OUT_DIR, 'soundbank.json');

const AUDIO_EXT = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.aif', '.aiff', '.webm']);

// Genre/Farb-Zuordnung für die Pads (Remixlive-Look)
const PALETTES = [
  '#f43f5e', '#fb923c', '#facc15', '#4ade80',
  '#22d3ee', '#818cf8', '#e879f9', '#f472b6',
];

function guessType(name) {
  const n = name.toLowerCase();
  if (/\b(loop|loop\d*)\b|_loop|-loop/.test(n)) return 'loop';
  return 'oneshot';
}

function guessBpm(name) {
  const m = basename(name).toLowerCase().match(/(\d{2,3})\s*bpm|bpm\s*(\d{2,3})/);
  if (!m) return null;
  return parseInt(m[1] || m[2], 10);
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (/kick|bd\b|bassdrum/.test(n)) return 'drums';
  if (/snare|clap|rim|snap/.test(n)) return 'drums';
  if (/hat|hh|shaker|tamb/.test(n)) return 'drums';
  if (/perc|tom|conga|bongo/.test(n)) return 'perc';
  if (/bass|sub|808|reese/.test(n)) return 'bass';
  if (/fx|riser|impact|sweep|down|whoosh/.test(n)) return 'fx';
  if (/vox|vocal|chant|voice/.test(n)) return 'vox';
  if (/pad|chord|keys|piano|synth|lead|arp|pluck|melo/.test(n)) return 'melody';
  return 'misc';
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (AUDIO_EXT.has(extname(entry).toLowerCase())) out.push(full);
  }
  return out;
}

function main() {
  const files = walk(SOUNDBANK_DIR).sort();
  const packs = new Map();

  for (const abs of files) {
    const rel = relative(SOUNDBANK_DIR, abs);
    const parts = rel.split('/');
    const packName = parts.length > 1 ? parts[0] : 'Soundbank';
    const url = '/soundbank/' + parts.map(encodeURIComponent).join('/');
    const name = basename(rel, extname(rel)).replace(/[_-]+/g, ' ').trim();

    if (!packs.has(packName)) packs.set(packName, []);
    packs.get(packName).push({
      id: rel.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
      name,
      url,
      type: guessType(rel),
      bpm: guessBpm(rel),
      category: guessCategory(rel),
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    packs: [...packs.entries()].map(([name, samples], i) => ({
      name,
      color: PALETTES[i % PALETTES.length],
      samples,
    })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));

  const total = manifest.packs.reduce((n, p) => n + p.samples.length, 0);
  console.log(`✔ Soundbank: ${manifest.packs.length} Pack(s), ${total} Sample(s) → src/generated/soundbank.json`);
  for (const p of manifest.packs) console.log(`   • ${p.name}: ${p.samples.length}`);
}

main();
