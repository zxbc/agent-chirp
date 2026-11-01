// Audio-engine smoke test: drives createAudioEngine with a mock AudioContext
// and verifies the Muse schedules real oscillators with sane parameters.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const loaded = {};
globalThis.window = { __ModuleLoader__: { load: (m) => { loaded.factory = m.factory; } } };
const fakeReact = { createElement: (...a) => a[0] };
new Function('window', src)(globalThis.window);
loaded.factory((name) => (name === 'react' ? fakeReact : {}));

const T = globalThis.window.__agentChirpTest;
if (!T) throw new Error('test seam missing');
const { createAudioEngine, midiHz } = T;

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
}

// --- Mock Web Audio ---
class MockParam {
  constructor(v) { this.value = v; this.ramps = []; }
  setValueAtTime(v, t) { this.value = v; }
  linearRampToValueAtTime(v, t) { this.ramps.push([v, t]); this.value = v; }
  exponentialRampToValueAtTime(v, t) { this.ramps.push([v, t]); this.value = v; }
}
class MockNode {
  constructor() { this.nodes = []; }
  connect(n) { this.nodes.push(n); return n; }
}
class MockOsc extends MockNode {
  constructor() { super(); this.type = 'sine'; this.frequency = new MockParam(0); this.detune = new MockParam(0); this.starts = []; this.stops = []; }
  start(t) { this.starts.push(t); }
  stop(t) { this.stops.push(t); }
}
class MockGain extends MockNode {
  constructor() { super(); this.gain = new MockParam(0); }
}
class MockFilter extends MockNode {
  constructor() { super(); this.type = 'lowpass'; this.frequency = new MockParam(0); }
}
class MockCtx {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.oscs = [];
    this.listeners = {};
  }
  createOscillator() { const o = new MockOsc(); this.oscs.push(o); return o; }
  createGain() { return new MockGain(); }
  createBiquadFilter() { return new MockFilter(); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  resume() {
    this.state = 'running';
    (this.listeners.statechange || []).forEach((fn) => fn());
  }
}
globalThis.AudioContext = MockCtx;
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
};

const ctx = new MockCtx();
const realAudioContext = globalThis.AudioContext;
// The engine constructs `new AudioContext()`; make it return our mock.
globalThis.AudioContext = function () { return ctx; };
globalThis.AudioContext.prototype = realAudioContext.prototype;

// Capture the pad interval; clearing it nulls the callback (like the real
// clearInterval would stop the loop).
let intervalCb = null;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (cb) => { intervalCb = cb; return { cb }; };
globalThis.clearInterval = (id) => { if (id && id.cb === intervalCb) intervalCb = null; };

try {
  const engine = createAudioEngine({ thinking: 1, answering: 1, tools: 1, done: 1 }, 1);
  engine.resume();
  check(ctx.state === 'running', 'resume() must start the context');
  engine.setPhase('thinking');

  // First phrase is scheduled immediately.
  const afterFirst = ctx.oscs.length;
  check(afterFirst >= 4, `first phrase scheduled ${afterFirst} oscillators, expected >= 4 (2 bass + melody)`);

  // Advance time and fire 5 more phrase ticks.
  for (let i = 0; i < 5; i++) {
    ctx.currentTime += 3.84;
    intervalCb();
  }
  const total = ctx.oscs.length;
  check(total > afterFirst, 'further ticks must schedule more oscillators');

  // Every oscillator: audible frequency, started before stopped, gain ramped.
  for (const o of ctx.oscs) {
    check(o.frequency.value > 40 && o.frequency.value < 4200, `osc freq ${o.frequency.value} Hz out of range`);
    check(o.starts.length === 1 && o.stops.length === 1, 'osc must start and stop exactly once');
    check(o.stops[0] > o.starts[0], 'osc.stop before osc.start');
    // Gain chain: osc -> (filter) -> gain -> master. Find the gain node.
    let g = o.nodes[0];
    while (g && !g.gain) g = g.nodes ? g.nodes[0] : null;
    check(!!g, 'osc must reach a gain node');
    if (g) {
      const peak = Math.max(...g.gain.ramps.map((r) => r[0]));
      check(peak > 0 && peak <= 0.1, `gain peak ${peak} outside (0, 0.1]`);
      const last = g.gain.ramps[g.gain.ramps.length - 1];
      check(last[0] < 0.001, 'gain must release to ~0');
    }
  }

  // Bass voices are plain sines straight to a gain; melody voices are
  // detuned pairs through a lowpass.
  const bassLike = ctx.oscs.filter((o) => o.frequency.value < 200);
  check(bassLike.length >= 2, `expected bass oscillators, got ${bassLike.length}`);
  const melodyLike = ctx.oscs.filter((o) => o.frequency.value >= 200);
  check(melodyLike.length >= 2, 'expected melody oscillators');
  const filtered = melodyLike.filter((o) => o.nodes[0] && o.nodes[0].type === 'lowpass');
  check(filtered.length === melodyLike.length, 'every melody voice must pass through a lowpass');
  const detuned = melodyLike.filter((o) => Math.abs(o.detune.value) > 0);
  check(detuned.length >= 1, 'at least one detuned melody voice expected');

  // Phase change to idle stops the pad: no new oscillators on the next tick.
  engine.setPhase('idle');
  const beforeTick = ctx.oscs.length;
  ctx.currentTime += 3.84;
  intervalCb && intervalCb();
  check(ctx.oscs.length === beforeTick, 'idle phase must not schedule new pad notes');

  // Done chime: soft bell arpeggio — 4 notes x (2 detuned main voices + 3
  // decaying echoes) = 20 sine oscillators, all lowpassed.
  const gainPeak = (o) => {
    let g = o.nodes[0];
    while (g && !g.gain) g = g.nodes ? g.nodes[0] : null;
    return g ? Math.max(...g.gain.ramps.map((r) => r[0])) : 0;
  };
  engine.done();
  const chime = ctx.oscs.slice(beforeTick);
  check(chime.length === 20, `done chime should use 20 oscillators, got ${chime.length}`);
  check(chime.every((o) => o.type === 'sine'), 'chime must use sine waves');
  const NOTES = [783.99, 659.25, 587.33, 523.25];
  check(chime.every((o) => NOTES.includes(o.frequency.value)), 'chime frequencies must be the arpeggio notes');
  check(chime.every((o) => o.nodes[0] && o.nodes[0].type === 'lowpass'), 'every chime voice must pass through a lowpass');
  check(chime.filter((o) => gainPeak(o) >= 0.09).length === 8, 'chime must have 8 main voices (2 per note)');
  check(chime.filter((o) => gainPeak(o) < 0.05).length === 12, 'chime must have 12 quiet echo voices');

  // Volume 0: melody events are skipped (peak guard).
  engine.setVolume('thinking', 0);
  engine.setPhase('thinking');
  const beforeSilent = ctx.oscs.length;
  ctx.currentTime += 3.84;
  intervalCb && intervalCb();
  check(ctx.oscs.length === beforeSilent, 'zero thinking volume must schedule nothing');
  engine.dispose();
} finally {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log(`audio engine test passed (${ctx.oscs.length} oscillators scheduled)`);
