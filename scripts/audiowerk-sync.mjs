#!/usr/bin/env node
/**
 * AUDiOWERK → Remix Station Sync
 * ------------------------------
 * Holt eine kuratierte Auswahl aus der lokalen AUDiOWERK/SAMPLE-CORE-API
 * (Standard: http://127.0.0.1:9096) in public/soundbank/ – danach
 * `npm run soundbank` ausführen, das Manifest wird automatisch gebaut.
 *
 * Aufruf:  node scripts/audiowerk-sync.mjs [--api http://127.0.0.1:9096] [--max-mb 40]
 *
 * Namenskonventionen der Quelle: <hash>_<Name>[_<BPM>_<Nr>].wav
 * → Hash wird entfernt; Dateien mit BPM-Muster (60–200) werden als
 *   „… loop <bpm>bpm.wav“ gespeichert, damit der Scanner sie als
 *   takt-quantisierte Loops erkennt.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT_BASE = join(root, 'public', 'soundbank');

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const API = argVal('api', process.env.AUDIOWERK_API || 'http://127.0.0.1:9096');
const MAX_TOTAL_MB = Number(argVal('max-mb', 40));
const MAX_FILE_KB = 3072;

/** Kuratierter Sync-Plan: Pack → Suchbegriffe mit gewünschter Stückzahl. */
const PLAN = [
  ['AUDiOWERK Drums', [['kick', 5], ['snare', 4], ['hh', 4], ['ride', 3], ['tom', 3], ['clap', 3]]],
  ['AUDiOWERK Percussion', [['conga', 3], ['djembe', 3], ['bongo', 3], ['darabuka', 2], ['perc', 3]]],
  ['AUDiOWERK Keys Strings', [['piano', 4], ['b3', 3], ['clavinet', 2], ['strings', 3], ['viola', 2], ['harpsichord', 2]]],
  ['AUDiOWERK FX', [['sfx', 4], ['gong', 2], ['glitch', 3], ['metal', 2], ['riser', 2]]],
];

const AUDIO_EXT = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.aif']);
const seen = new Set();
let totalBytes = 0;

async function api(path) {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`AUDiOWERK API ${path}: HTTP ${res.status}`);
  return res;
}

function cleanName(name, ext) {
  let n = name.replace(/^[0-9a-f]{12,}_/i, '').replace(new RegExp(`\\${ext}$`, 'i'), '');
  // BPM-Loop-Muster: _<60-200>_<Nr> am Ende
  const m = n.match(/_(\d{2,3})_(\d{1,2})$/);
  if (m && Number(m[1]) >= 60 && Number(m[1]) <= 200) {
    n = `${n.slice(0, m.index)} loop ${m[1]}bpm`;
  }
  return n.replace(/[_-]+/g, ' ').trim();
}

async function syncQuery(packDir, q, want) {
  if (want <= 0) return 0;
  const res = await api(`/sample-core/list?q=${encodeURIComponent(q)}&limit=100`);
  const data = await res.json();
  const candidates = (data.files || [])
    .filter((f) => f.available && AUDIO_EXT.has(f.ext.toLowerCase()) && f.size > 0)
    .filter((f) => f.size <= MAX_FILE_KB * 1024)
    .sort((a, b) => a.name.localeCompare(b.name));

  let got = 0;
  for (const f of candidates) {
    if (got >= want) break;
    if (totalBytes + f.size > MAX_TOTAL_MB * 1024 * 1024) return got;
    const base = cleanName(f.name, f.ext);
    if (!base || seen.has(base.toLowerCase())) continue;
    const out = join(packDir, `${base}${f.ext.toLowerCase()}`);
    if (existsSync(out)) {
      seen.add(base.toLowerCase());
      continue;
    }
    const dl = await api(`/sample-core/file?path=${encodeURIComponent(f.path)}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    writeFileSync(out, buf);
    seen.add(base.toLowerCase());
    totalBytes += buf.length;
    got += 1;
    console.log(`   ↳ ${base}${f.ext}  (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  return got;
}

async function main() {
  console.log(`AUDiOWERK-Sync von ${API} (Limit ${MAX_TOTAL_MB} MB)\n`);

  // Verfügbarkeit prüfen
  try {
    const idx = await (await api('/sample-core/index')).json();
    console.log(`Verbunden: ${idx.root} – ${idx.total} Dateien\n`);
  } catch (e) {
    console.error(`✘ AUDiOWERK nicht erreichbar: ${e.message}`);
    console.error('  Läuft der SAMPLE-CORE-Server (Port 9096)?');
    process.exit(1);
  }

  const summary = {};
  for (const [pack, queries] of PLAN) {
    const packDir = join(OUT_BASE, pack);
    mkdirSync(packDir, { recursive: true });
    console.log(`▸ ${pack}`);
    let count = 0;
    for (const [q, want] of queries) {
      try {
        count += await syncQuery(packDir, q, want);
      } catch (e) {
        console.warn(`   ⚠ Suche „${q}“: ${e.message}`);
      }
    }
    summary[pack] = count;
    console.log(`   → ${count} neue Dateien\n`);
  }

  console.log('Fertig:', JSON.stringify(summary));
  console.log(`Gesamt neu: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log('Jetzt Manifest bauen: npm run soundbank');
}

main();
