// Barcode reading. Uses the phone camera and the ZXing library (works in Safari on iPhone).
// If the browser has its own barcode reader, that is used first.

let zxingPromise = null;

function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/zxing.min.js';
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingPromise = null; reject(new Error('Could not load the barcode reader.')); };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

export function validEan(code) {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

let reader = null;
async function getReader() {
  const Z = await loadZXing();
  if (reader) return reader;
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.EAN_8]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  return reader;
}

async function decodeCanvas(canvas) {
  const Z = await loadZXing();
  const r = await getReader();
  try {
    const lum = new Z.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(lum));
    const res = r.decode(bitmap);
    return res ? res.getText() : null;
  } catch {
    return null; // nothing found in this frame
  }
}

// Read a barcode from a photo file.
export async function decodeFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open that photo.'));
      i.src = url;
    });
    for (const max of [1600, 1000, 2400]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const text = await decodeCanvas(c);
      if (text && validEan(text)) return text;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class Scanner {
  constructor(video, guide) {
    this.video = video;
    this.guide = guide;
    this.stream = null;
    this.paused = false;
    this.stopped = false;
    this.timer = null;
    this.canvas = document.createElement('canvas');
    this.detector = null;
  }

  async start(onCode) {
    this.onCode = onCode;
    this.stopped = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('This browser cannot use the camera here. Open the app from your home screen over https.');
    }
    await loadZXing();
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        const want = ['ean_13', 'upc_a', 'upc_e', 'ean_8'].filter((f) => formats.includes(f));
        if (want.length) this.detector = new window.BarcodeDetector({ formats: want });
      } catch { this.detector = null; }
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const v = this.video;
    v.srcObject = this.stream;
    v.setAttribute('playsinline', '');
    v.muted = true;
    await v.play();
    try {
      const track = this.stream.getVideoTracks()[0];
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* not supported, that is fine */ }
    this.tick();
  }

  pause() { this.paused = true; }
  // After resuming, ignore the same barcode for 3 seconds so a skipped record does not pop up again.
  resume() { this.paused = false; this.lastUntil = Date.now() + 3000; }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  // The part of the video inside the guide box, in video pixels.
  cropRect() {
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const vb = v.getBoundingClientRect();
    const gb = this.guide.getBoundingClientRect();
    const scale = Math.max(vb.width / vw, vb.height / vh);
    const offX = (vw * scale - vb.width) / 2;
    const offY = (vh * scale - vb.height) / 2;
    let x = (gb.left - vb.left + offX) / scale;
    let y = (gb.top - vb.top + offY) / scale;
    let w = gb.width / scale;
    let h = gb.height / scale;
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    return { x, y, w, h };
  }

  async tick() {
    if (this.stopped) return;
    const v = this.video;
    if (!this.paused && v.readyState >= 2 && v.videoWidth) {
      try {
        let code = null;
        const r = this.cropRect();
        if (this.detector) {
          const found = await this.detector.detect(v);
          if (found && found[0]) code = found[0].rawValue;
        }
        if (!code) {
          const c = this.canvas;
          c.width = Math.round(r.w);
          c.height = Math.round(r.h);
          c.getContext('2d', { willReadFrequently: true }).drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
          code = await decodeCanvas(c);
        }
        if (code && validEan(code) && !this.paused && !(code === this.last && Date.now() < (this.lastUntil || 0))) {
          this.last = code;
          this.lastUntil = Infinity;
          this.onCode(code);
        }
      } catch (e) {
        console.warn('scan frame', e);
      }
    }
    this.timer = setTimeout(() => this.tick(), 110);
  }
}

let ac = null;
export function unlockAudio() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch { /* no sound */ }
}

export function beep() {
  try {
    unlockAudio();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 1040;
    g.gain.value = 0.07;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.09);
  } catch { /* no sound */ }
}
