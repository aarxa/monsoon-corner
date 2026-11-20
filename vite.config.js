import { defineConfig } from 'vite';
import { readdirSync, statSync } from 'node:fs';

// the size of each model, so the loading bar can count real bytes even when a host doesn't send a
// Content-Length (src/loading.js)
const dir = new URL('./public/models/', import.meta.url);
const sizes = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => [f, statSync(new URL(f, dir)).size]));

export default defineConfig({
  define: { __MODEL_BYTES__: JSON.stringify(sizes) },
});
