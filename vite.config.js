import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const dir = new URL('./public/models/', import.meta.url);
const models = readdirSync(dir).filter((f) => f.endsWith('.glb'));
// the size of each model, so the loading bar can count real bytes even when a host doesn't send a
// Content-Length (src/loading.js)
const sizes = Object.fromEntries(models.map((f) => [f, statSync(new URL(f, dir)).size]));
// and a short hash of each, asked for as ?v=<hash>: browsers can keep a model for a year (public/_headers),
// and a changed model gets a new address
const hashes = Object.fromEntries(models.map((f) => [f, createHash('sha1').update(readFileSync(new URL(f, dir))).digest('hex').slice(0, 10)]));

export default defineConfig({
  define: { __MODEL_BYTES__: JSON.stringify(sizes), __MODEL_HASH__: JSON.stringify(hashes) },
});
