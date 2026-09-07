/**
 * A browser, near enough.
 *
 * The screens are plain DOM, so most of them can be mounted and driven in
 * Node — which is the only way this project gets to find out whether a screen
 * throws before someone opens it on a phone in a living room.
 *
 * jsdom is missing three things the game uses: a canvas context, <dialog>'s
 * modal methods, and the observers. All three are stubbed to the shape the
 * code actually calls, not to spec.
 */
import { JSDOM } from 'jsdom';

/** A 2D context that records nothing and refuses nothing. */
function fakeContext(canvas) {
  const noop = () => {};
  return {
    canvas,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    lineCap: 'round', lineJoin: 'round', font: '10px sans-serif',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    filter: 'none', textAlign: 'start', textBaseline: 'alphabetic',
    save: noop, restore: noop, scale: noop, rotate: noop, translate: noop,
    transform: noop, setTransform: noop, resetTransform: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, roundRect: noop, fill: noop, stroke: noop,
    clip: noop, drawImage: noop, putImageData: noop, fillText: noop,
    strokeText: noop, setLineDash: noop, getLineDash: () => [],
    measureText: (text) => ({ width: String(text).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({
      width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    }),
    createImageData: (w, h) => ({
      width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    }),
  };
}

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    this.__ctx ??= fakeContext(this);
    return this.__ctx;
  };
  window.HTMLCanvasElement.prototype.toDataURL = () =>
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  window.HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { cb(new window.Blob([])); };

  // jsdom implements <dialog> as an element but not its modal behaviour.
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => {};

  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // jsdom lays nothing out, so every rect is zero and every pointer coordinate
  // maps to NaN. A fixed square is enough for the drawing tool to behave as if
  // it were on screen.
  window.Element.prototype.getBoundingClientRect = function rect() {
    const size = 512;
    return {
      x: 0, y: 0, width: size, height: size,
      top: 0, left: 0, right: size, bottom: size,
      toJSON() { return this; },
    };
  };
  window.matchMedia ??= () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  window.confirm = () => true;
  window.alert = () => {};
  window.scrollTo = () => {};

  // A store that behaves, so settings can be exercised for real. jsdom's own
  // localStorage is getter-only, hence the redefine.
  const store = new Map();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  } });

  for (const key of [
    'window', 'document', 'navigator', 'location', 'localStorage', 'matchMedia',
    'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'HTMLDialogElement',
    'Image', 'Event', 'CustomEvent', 'PointerEvent', 'MouseEvent', 'KeyboardEvent',
    'FileReader', 'Blob', 'File', 'FormData', 'DOMMatrix', 'Node', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'confirm',
  ]) {
    if (window[key] === undefined) continue;
    // Node defines some of these (navigator, location) as getters of its own.
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value: window[key],
    });
  }
  // Pointer events are what every gesture in the drawing tool is built on, and
  // jsdom has no constructor for them.
  if (typeof globalThis.PointerEvent !== 'function') {
    globalThis.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.pressure = init.pressure ?? 0.5;
        this.isPrimary = init.isPrimary ?? true;
      }
      getCoalescedEvents() { return [this]; }
    };
    window.PointerEvent = globalThis.PointerEvent;
  }

  return dom;
}
