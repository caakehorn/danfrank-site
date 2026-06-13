#!/usr/bin/env node
// Encrypt the LEVIATHAN data files into a single AES-256-GCM bundle that the
// site decrypts in-browser with the passphrase. The plaintext JSON is never
// committed — keep it locally (it is gitignored) and re-run this after changes.
//
// Usage:  PW='your passphrase' node encrypt-data.mjs [dataDir]
//   dataDir defaults to ./data
//
// Output: <dataDir>/leviathan.enc  (the only data file that gets committed)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const subtle = globalThis.crypto.subtle;
const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64 = (buf) => Buffer.from(buf).toString('base64');

// resource-id -> filename  (must match the ids used in index.html loadData)
const FILES = {
  messages: 'messages.json',
  places: 'places.json',
  favs: 'favs.json',
  rhetoricalDaily: 'rhetorical_daily.json',
  rhetoricalEvents: 'top_rhetorical_events.json',
  annie: 'annie_rhetoric.json',
  fragments: 'high_emotion_fragments.json',
  youtubeDaily: 'youtube_daily.json',
  youtubeEntities: 'youtube_top_entities.json',
  youtubeInfluence: 'youtube_music_influence.json',
  weatherWeeklyNA: 'weather_non_annie_weekly.json',
  weatherAnalysis: 'weather_analysis.json',
  weatherFragsNA: 'weather_fragments_non_annie.json',
  dailyCross: 'daily_cross_corpus.json',
};

const ITER = 250000;
const pw = process.env.PW;
if (!pw) { console.error('Set PW env var to the passphrase.'); process.exit(1); }
const dataDir = process.argv[2] || join(import.meta.dirname, 'data');

const bundle = {};
for (const [id, file] of Object.entries(FILES)) {
  bundle[id] = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
}
const plaintext = new TextEncoder().encode(JSON.stringify(bundle));

const salt = rnd(16);
const iv = rnd(12);
const base = await subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
const key = await subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
  base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

const out = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
const outPath = join(dataDir, 'leviathan.enc');
writeFileSync(outPath, JSON.stringify(out));
console.log(`Encrypted ${Object.keys(FILES).length} files -> ${outPath} (${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`);
