// A "source" emits the same events whether data comes from the live SDK or a saved recording:
//   metrics(buf, ts) · validationStatus(code, ts, hint) · processingStatus(status)
//   error(code, message, retryable) · fps(sent, dropped) · ended()

const RECORDING_VERSION = 1;

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

class LiveSource extends Emitter {
  constructor(sdk, stream, meta) {
    super();
    this.sdk = sdk;
    this.stream = stream;
    this.meta = meta;
    this.lines = [];
    this.running = false;
    this._sent = 0;
    this._dropped = 0;

    sdk.on('metrics', (buf, ts) => {
      this._record({ type: 'metrics', ts, b64: u8ToB64(buf) });
      this.emit('metrics', buf, ts);
    });
    sdk.on('validationStatus', (code, ts, hint) => {
      this._record({ type: 'validation', code, ts, hint });
      this.emit('validationStatus', code, ts, hint);
    });
    sdk.on('processingStatus', (status) => {
      this._record({ type: 'status', status });
      this.emit('processingStatus', status);
    });
    sdk.on('error', (code, message, retryable) => {
      this._record({ type: 'error', code, message, retryable });
      this.emit('error', code, message, retryable);
    });
    sdk.on('frameSentThrough', (sent) => {
      if (sent) this._sent += 1; else this._dropped += 1;
    });
  }

  _record(obj) {
    if (!this._t0) return;
    this.lines.push(JSON.stringify({ t: Math.round(performance.now() - this._t0), ...obj }));
  }

  async start() {
    this._t0 = performance.now();
    this.lines = [JSON.stringify({ type: 'meta', version: RECORDING_VERSION, startedAt: new Date().toISOString(), ...this.meta })];
    this._fpsTimer = setInterval(() => {
      this._record({ type: 'fps', sent: this._sent, dropped: this._dropped });
      this.emit('fps', this._sent, this._dropped);
      this._sent = 0;
      this._dropped = 0;
    }, 1000);
    this.running = true;
    this.sdk.useMediaStream(this.stream);
    await this.sdk.start();
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._fpsTimer);
    try {
      await this.sdk.stop();
    } finally {
      this._record({ type: 'end' });
      this.emit('ended');
    }
  }

  recordingText() {
    return this.lines.join('\n') + '\n';
  }
}

class ReplaySource extends Emitter {
  constructor(text, speed = 1) {
    super();
    const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    this.meta = rows.find((r) => r.type === 'meta') || {};
    this.events = rows.filter((r) => r.type !== 'meta');
    this.speed = speed;
    this.running = false;
    this.durationMs = this.events.length ? this.events[this.events.length - 1].t : 0;
  }

  async start() {
    this.running = true;
    const t0 = performance.now();
    let i = 0;
    const tick = () => {
      if (!this.running) return;
      const elapsed = (performance.now() - t0) * this.speed;
      while (i < this.events.length && this.events[i].t <= elapsed) this._dispatch(this.events[i++]);
      if (i >= this.events.length) {
        this.running = false;
        this.emit('ended');
        return;
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
