// One GLTFLoader for every model, able to read Draco-compressed meshes (the decoder lives in public/draco).
// Every model it loads reports its download progress to the loading screen (src/loading.js).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { loading } from './loading.js';

const draco = new DRACOLoader();
draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
draco.setDecoderConfig({ type: 'wasm' });

export const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);

const loadAsync = gltfLoader.loadAsync.bind(gltfLoader);
gltfLoader.loadAsync = (url, onProgress) => loadAsync(url, (e) => {
  loading.progress(url, e.loaded, e.lengthComputable ? e.total : 0);
  onProgress?.(e);
}).finally(() => loading.ready(url));
