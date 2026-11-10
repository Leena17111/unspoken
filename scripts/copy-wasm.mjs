// Copy MediaPipe's WASM runtime into public/ so the app works offline and on GitHub Pages.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/mediapipe', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', { recursive: true });
console.log('Copied MediaPipe WASM to public/mediapipe');
