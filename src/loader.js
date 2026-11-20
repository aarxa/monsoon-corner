// One GLTFLoader for every model, able to read Draco-compressed meshes (the decoder lives in public/draco).
// Every model it loads reports its download progress to the loading screen (src/loading.js), and is asked
// for at an address that changes with its contents (?v=<hash>), so browsers can keep it cached.
/* global __MODEL_HASH__ */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { loading } from './loading.js';

const draco = new DRACOLoader();
draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
draco.setDecoderConfig({ type: 'wasm' });

const HASH = typeof __MODEL_HASH__ === 'object' ? __MODEL_HASH__ : {};
/** a model's address with its content hash on, e.g. models/street.glb?v=3f2a9c01be */
export function versioned(url) {
  const h = HASH[url.split('/').pop()];
  return h ? `${url}?v=${h}` : url;
}

export const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

const loadAsync = gltfLoader.loadAsync.bind(gltfLoader);
gltfLoader.loadAsync = (url, onProgress) => loadAsync(versioned(url), (e) => {
  loading.progress(url, e.loaded, e.lengthComputable ? e.total : 0);
  onProgress?.(e);
}).finally(() => loading.ready(url));
