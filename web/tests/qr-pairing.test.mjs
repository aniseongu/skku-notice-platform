import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'uqr';
import { startQrScanner } from '../src/qr-pairing.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function environment(t, { media, detector, pixels } = {}) {
  const originals = new Map();
  const set = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  let timer = null;
  let frame = null;
  window.setTimeout = (callback) => { timer = callback; return 1; };
  window.clearTimeout = () => { timer = null; };
  document.createElement = () => ({
    getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: pixels }) }),
  });
  set('window', window);
  set('document', document);
  set('navigator', media === undefined ? {} : { mediaDevices: { getUserMedia: media } });
  set('requestAnimationFrame', (callback) => { frame = callback; return 1; });
  set('cancelAnimationFrame', () => { frame = null; });
  set('BarcodeDetector', detector);
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { window, document, fireTimer: () => timer?.(), fireFrame: () => frame?.() };
}

function video(size = 1) {
  return { srcObject: null, muted: false, playsInline: false, readyState: 2,
    videoWidth: size, videoHeight: size, play: async () => {} };
}

function stream() {
  let stops = 0;
  return { getTracks: () => [{ stop: () => { stops += 1; } }], stops: () => stops };
}

test('native detector sends only the scanned result and stops the camera', async (t) => {
  const camera = stream();
  const raw = 'https://example.test/#token=private';
  const env = environment(t, { media: async () => camera,
    detector: class { async detect() { return [{ rawValue: raw }]; } } });
  const element = video();
  const results = [];
  const stop = startQrScanner(element, (value) => results.push(value), assert.fail);
  await tick(); env.fireFrame(); await tick();
  assert.deepEqual(results, [raw]);
  assert.equal(camera.stops(), 1);
  assert.equal(element.srcObject, null);
  stop(); assert.equal(camera.stops(), 1);
});

test('camera is stopped when permission resolves after cancellation', async (t) => {
  const camera = stream();
  let allow;
  environment(t, { media: () => new Promise((resolve) => { allow = resolve; }) });
  const results = [];
  const stop = startQrScanner(video(), (value) => results.push(value), (error) => results.push(error));
  await tick(); stop(); allow(camera); await tick();
  assert.equal(camera.stops(), 1);
  assert.deepEqual(results, []);
});

test('permission denial reports a safe error', async (t) => {
  const denied = new Error('sensitive'); denied.name = 'NotAllowedError';
  environment(t, { media: async () => { throw denied; } });
  const errors = [];
  startQrScanner(video(), assert.fail, (error) => errors.push(error));
  await tick(); assert.deepEqual(errors, ['denied']);
});

test('hiding the tab stops all opened camera tracks', async (t) => {
  const camera = stream();
  const env = environment(t, { media: async () => camera, detector: class { async detect() { return []; } } });
  const errors = [];
  const element = video();
  startQrScanner(element, assert.fail, (error) => errors.push(error));
  await tick();
  env.document.visibilityState = 'hidden';
  env.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(errors, ['hidden']);
  assert.equal(camera.stops(), 1);
  assert.equal(element.srcObject, null);
});

test('timeout closes a camera even when permission remains pending', async (t) => {
  let allow;
  const camera = stream();
  const env = environment(t, { media: () => new Promise((resolve) => { allow = resolve; }) });
  const errors = [];
  startQrScanner(video(), assert.fail, (error) => errors.push(error));
  await tick(); env.fireTimer(); allow(camera); await tick();
  assert.deepEqual(errors, ['timeout']);
  assert.equal(camera.stops(), 1);
});

test('jsQR fallback decodes an actual generated QR image', async (t) => {
  const data = 'https://example.test/#pairing=example';
  const qr = encode(data, { border: 4 });
  const scale = 4;
  const size = qr.size * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = qr.data[Math.floor(y / scale)][Math.floor(x / scale)] ? 0 : 255;
    const pos = (y * size + x) * 4;
    pixels.set([value, value, value, 255], pos);
  }
  const camera = stream();
  const env = environment(t, { media: async () => camera, pixels });
  const results = [];
  startQrScanner(video(size), (value) => results.push(value), assert.fail);
  for (let i = 0; i < 30 && !results.length; i++) { await tick(); env.fireFrame(); }
  assert.deepEqual(results, [data]);
  assert.equal(camera.stops(), 1);
});
