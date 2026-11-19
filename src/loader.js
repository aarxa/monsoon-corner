// One GLTFLoader for every model, able to read Draco-compressed meshes (the decoder lives in public/draco).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader();
draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
draco.setDecoderConfig({ type: 'wasm' });

export const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);
