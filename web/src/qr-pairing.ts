// 출처: https://github.com/cozmo/jsQR#usage
// QR 값은 호출자에게만 넘긴다. 주소 이동과 저장은 여기서 하지 않는다.
export type QrScanError = 'unsupported' | 'denied' | 'timeout' | 'camera' | 'decode' | 'hidden';

type Barcode = { rawValue?: string };
type Detector = { detect(source: HTMLVideoElement): Promise<Barcode[]> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;
type Decoder = (pixels: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

/** 사용자 조작에서 호출한다. 반환한 함수는 권한 창이 열려 있는 동안에도 취소할 수 있다. */
export function startQrScanner(
  video: HTMLVideoElement, onResult: (raw: string) => void, onError: (reason: QrScanError) => void,
): () => void {
  let closed = false;
  let stream: MediaStream | null = null;
  let frame = 0;
  let timer = 0;
  let detector: Detector | null = null;
  let decoder: Decoder | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const stop = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      if (video.srcObject === stream) video.srcObject = null;
      stream = null;
    }
  };
  const fail = (reason: QrScanError) => { if (!closed) { stop(); onError(reason); } };
  const onVisibility = () => { if (document.visibilityState !== 'visible') fail('hidden'); };
  const onPageHide = () => fail('hidden');
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  timer = window.setTimeout(() => fail('timeout'), 60_000);

  const fallback = async () => {
    if (!decoder) decoder = (await import('jsqr')).default;
    if (!canvas) canvas = document.createElement('canvas');
  };
  const scan = async () => {
    if (closed) return;
    try {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        let raw: string | undefined;
        if (detector) {
          try { raw = (await detector.detect(video))[0]?.rawValue; }
          catch { detector = null; await fallback(); }
        }
        if (!detector && !raw) {
          await fallback();
          if (closed) return;
          const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas!.width = width;
          canvas!.height = height;
          const context = canvas!.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('canvas unavailable');
          context.drawImage(video, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height);
          raw = decoder!(pixels.data, width, height)?.data;
        }
        if (closed) return;
        if (raw) { stop(); onResult(raw); return; }
      }
      if (!closed) frame = requestAnimationFrame(() => { void scan(); });
    } catch { fail('decode'); }
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { fail('unsupported'); return; }
    try {
      const opened = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
      if (closed) { for (const track of opened.getTracks()) track.stop(); return; }
      stream = opened;
      video.srcObject = opened;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      if (closed) return;
      const NativeDetector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (NativeDetector) {
        try { detector = new NativeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
      }
      if (!detector) {
        try { await fallback(); } catch { fail('decode'); return; }
      }
      if (!closed) frame = requestAnimationFrame(() => { void scan(); });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      fail(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'camera');
    }
  };
  queueMicrotask(() => { if (!closed) void start(); });
  return stop;
}
