import * as wa from 'node-web-audio-api';
// expose Web Audio classes as globals, like a browser
for (const [k, v] of Object.entries(wa)) if (!(k in globalThis)) (globalThis as any)[k] = v;
