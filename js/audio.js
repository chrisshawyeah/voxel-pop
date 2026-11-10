// Every sound is made on the spot with the Web Audio API; there are no sound files.
// The sound button in the top bar sets `on` for both the sounds and the buzz (js/main.js).

// Ordinary pops are soft, low and nearly the same note, and however many shots land (the pads
// fire about 30 shots a second each) at most one sounds every POP_GAP seconds. The bright rising
// notes are kept for a crew member finishing, a colour cleared and a level won.
const POPS = [392, 440, 392, 415.3];
const POP_GAP = 0.11; // about 9 pops a second at most
const VOLUME = 0.5;

export class Sound {
  constructor() {
    this._on = true;
    this.ctx = null;
    this.lastPop = 0;
    this.popIndex = 0;
  }

  // Off silences everything at once, notes already playing or scheduled (a fanfare) included:
  // the master volume goes to 0 within 5 ms. On brings it back.
  get on() { return this._on; }
  set on(v) {
    this._on = !!v;
    if (!this.master) return;
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this._on ? VOLUME : 0, t + 0.005);
  }

  // Browsers start audio only after a tap.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._on ? VOLUME : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // A cube pops (many landing together make one soft pop).
  pop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPop < POP_GAP) return;
    this.lastPop = now;
    this.popIndex = (this.popIndex + 1) % POPS.length;
    this.tone(POPS[this.popIndex], 0.06, { type: 'triangle', vol: 0.1, slide: 1.3 });
  }

  send() { this.tone(330, 0.12, { vol: 0.25, slide: 1.8 }); }
  done() { this.tone(784, 0.1, { vol: 0.16 }); this.tone(1046, 0.14, { vol: 0.14, delay: 0.07 }); }
  clear() { [659, 880, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.17, delay: i * 0.06 })); }
  reveal() { [1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.09, { vol: 0.08, delay: i * 0.05 })); }
  nope() { this.tone(220, 0.12, { type: 'square', vol: 0.06 }); }
  undo() { this.tone(523, 0.1, { vol: 0.14, slide: 0.6 }); }
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.09 })); }
  allClear() {
    [523, 659, 784, 1046, 784, 1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.26, { type: 'triangle', vol: 0.2, delay: i * 0.11 }));
  }
  jam() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.18, delay: i * 0.14 })); }
}

// Haptics. Android has navigator.vibrate; iPhone Safari (iOS 18 and later) gives a tick when
// a switch-style checkbox is toggled, so a hidden one is clicked.
export class Buzz {
  constructor(label) { this.label = label; this.on = true; this.last = 0; }
  tick(gap = 60) {
    if (!this.on) return;
    const now = performance.now();
    if (now - this.last < gap) return;
    this.last = now;
    if (navigator.vibrate) navigator.vibrate(8);
    else if (this.label) this.label.click();
  }
}
