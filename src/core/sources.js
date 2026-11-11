// A "source" emits the same events whether data comes from the live SDK or a saved recording:
//   metrics(buf, ts) · validationStatus(code, ts, hint) · processingStatus(status)
//   error(code, message, retryable) · fps(sent, dropped) · ended() · loop()

const RECORDING_VERSION = 1;
const FLUSH_INTERVAL_MS = 2000;

class Emitter {
  constructor() { this._handlers = {}; }
  on(event, fn) { (this._handlers[event] ||= []).push(fn); return this; }
  emit(event, ...args) { for (const fn of this._handlers[event] || []) fn(...args); }
}

function u8ToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToU8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// The SDK itself runs in the main process (see src/main/main.js); `bridge` is window.gutCheck.sdk.
// `recorder` is window.gutCheck.recording: the recording is appended to disk every few seconds,
// so a crash or closed window loses at most the last couple of seconds.
class LiveSource extends Emitter {
  constructor(bridge, recorder, meta) {
    super();
    this.bridge = bridge;
    this.recorder = recorder;
    this.meta = meta;
    this.running = false;
    this.recordingName = null;
    this._pending = [];
    this._sent = 0;
    this._dropped = 0;

    bridge.onEvent((name, ...args) => {
      if (!this.running) return;
      switch (name) {
        case 'metrics': {
          const [buf, ts] = args;
          this._record({ type: 'metrics', ts, b64: u8ToB64(buf) });
          this.emit('metrics', buf, ts);
          break;
        }
        case 'validationStatus': {
          const [code, ts, hint] = args;
          this._record({ type: 'validation', code, ts, hint });
          this.emit('validationStatus', code, ts, hint);
          break;
        }
        case 'processingStatus':
          this._record({ type: 'status', status: args[0] });
          this.emit('processingStatus', args[0]);
          break;
        case 'error': {
          const [code, message, retryable] = args;
          this._record({ type: 'error', code, message, retryable });
          this.emit('error', code, message, retryable);
          break;
        }
        case 'frameSentThrough':
          if (args[0]) this._sent += 1; else this._dropped += 1;
          break;
      }
    });
  }

  _record(obj) {
    if (this._t0 == null) return;
    this._pending.push(JSON.stringify({ t: Math.round(performance.now() - this._t0), ...obj }));
  }

  // Extra annotations (e.g. session phase changes), on the same clock as the SDK events.
  mark(obj) {
    this._record({ type: 'mark', ...obj });
  }

  async _flush() {
    if (!this.recordingName || !this._pending.length) return;
    const text = this._pending.join('\n') + '\n';
    this._pending = [];
    await this.recorder.append(this.recordingName, text);
  }

  async start() {
    this._t0 = performance.now();
    this.recordingName = await this.recorder.begin();
    this._pending.unshift(JSON.stringify({ type: 'meta', version: RECORDING_VERSION, startedAt: new Date().toISOString(), ...this.meta }));
    this._flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
    this._fpsTimer = setInterval(() => {
      this._record({ type: 'fps', sent: this._sent, dropped: this._dropped });
      this.emit('fps', this._sent, this._dropped);
      this._sent = 0;
      this._dropped = 0;
    }, 1000);
    this.running = true;
    const res = await this.bridge.start();
    if (!res.ok) {
      throw Object.assign(new Error(res.error.message), { code: res.error.code, retryable: res.error.retryable });
    }
  }

  async stop() {
    if (!this.running) return;
    clearInterval(this._fpsTimer);
    clearInterval(this._flushTimer);
    try {
      await this.bridge.stop();
    } finally {
      this.running = false;
      this._record({ type: 'end' });
      await this._flush();
      this.emit('ended');
    }
  }
}

class ReplaySource extends Emitter {
  constructor(text, { speed = 1, loop = false } = {}) {
    super();
    const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    this.meta = rows.find((r) => r.type === 'meta') || {};
    this.events = rows.filter((r) => r.type !== 'meta');
    this.speed = speed;
    this.loop = loop;
    this.running = false;
    this.durationMs = this.events.length ? this.events[this.events.length - 1].t : 0;
  }

  async start() {
    this.running = true;
    let t0 = performance.now();
    let i = 0;
    const tick = () => {
      if (!this.running) return;
      const elapsed = (performance.now() - t0) * this.speed;
      while (i < this.events.length && this.events[i].t <= elapsed) this._dispatch(this.events[i++]);
      if (i >= this.events.length) {
        if (!this.loop || !this.durationMs) {
          this.running = false;
          this.emit('ended');
          return;
        }
        t0 = performance.now();
        i = 0;
        this.emit('loop');
      }
      this._timer = setTimeout(tick, 20);
    };
    tick();
  }

  _dispatch(e) {
    switch (e.type) {
      case 'metrics': this.emit('metrics', b64ToU8(e.b64), e.ts); break;
      case 'validation': this.emit('validationStatus', e.code, e.ts, e.hint); break;
      case 'status': this.emit('processingStatus', e.status); break;
      case 'error': this.emit('error', e.code, e.message, e.retryable); break;
      case 'fps': this.emit('fps', e.sent, e.dropped); break;
      case 'mark': this.emit('mark', e); break;
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this._timer);
    this.emit('ended');
  }
}

module.exports = { LiveSource, ReplaySource };
