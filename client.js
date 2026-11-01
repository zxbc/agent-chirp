window.__ModuleLoader__.load({
  id: '@local/agent-chirp',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // --- The Muse: a small procedural composer for the thinking sound ---
    // It generates a different, musically coherent melody every phrase so the
    // sound never loops. Full design: docs/thinking-melody.md
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midiName = (m) => NOTE_NAMES[m % 12] + String(Math.floor(m / 12) - 1);
    const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

    // Deterministic PRNG so a seed reproduces an entire "session" of music.
    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // Contemplative modes as semitone offsets from the root.
    const MODES = {
      minorPent: [0, 3, 5, 7, 10],
      dorian: [0, 2, 3, 5, 7, 9, 10],
      mixolydian: [0, 2, 4, 5, 7, 9, 10],
      aeolian: [0, 2, 3, 5, 7, 8, 10],
    };

    // Calm 4-chord progressions per mode, as 0-based scale degrees. Each
    // chord lasts 4 beats, so a progression spans two 8-beat phrases.
    const PROGRESSIONS = {
      minorPent: [[0, 3, 4, 2], [0, 4, 3, 2], [3, 4, 0, 2], [0, 2, 3, 4]],
      dorian: [[0, 6, 3, 4], [0, 2, 3, 0], [0, 3, 4, 0], [6, 3, 4, 6]],
      mixolydian: [[0, 3, 6, 3], [0, 5, 3, 0], [0, 2, 3, 0], [3, 6, 3, 6]],
      aeolian: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [5, 2, 6, 5]],
    };

    // Keys: bass root in the low register; the melody register is two
    // octaves above it (bass+12 .. bass+34).
    const KEYS = [
      { mode: 'minorPent', bass: 45 },   // A minor pentatonic, A2
      { mode: 'minorPent', bass: 40 },   // E minor pentatonic, E2
      { mode: 'dorian', bass: 38 },      // D Dorian, D2
      { mode: 'mixolydian', bass: 43 },  // G Mixolydian, G2
      { mode: 'aeolian', bass: 45 },     // A Aeolian, A2
    ];

    function weightedPick(pairs, rng) {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let r = rng() * total;
      for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
      return pairs[pairs.length - 1][0];
    }

    function createComposer(seed) {
      const rng = mulberry32(seed === undefined ? (Math.random() * 0x100000000) >>> 0 : seed);
      const state = {
        keyIdx: Math.floor(rng() * KEYS.length),
        progression: null,
        phraseCount: 0,
        beat: 0,
        nextModulation: 6 + Math.floor(rng() * 7), // 6..12 phrases
        lastMidi: null,
        lastIdx: null,
        motif: null,
        motifPos: 0,
      };

      const key = () => KEYS[state.keyIdx];
      const scaleOffsets = () => MODES[key().mode];

      // Ascending scale notes in the melody register.
      function melodyScale(k, offs) {
        const out = [];
        for (const oct of [12, 24]) {
          for (const o of offs) {
            const m = k.bass + oct + o;
            if (m <= k.bass + 34) out.push(m);
          }
        }
        return out;
      }

      // Diatonic triad on scale degree `deg`, as midi notes in the melody
      // register (incomplete in pentatonic keys — that is fine).
      function chordTones(k, offs, deg) {
        const n = offs.length;
        const root = k.bass + 12 + offs[deg % n];
        const out = new Set([root]);
        for (const d of [deg + 2, deg + 4]) {
          let m = k.bass + 12 + offs[d % n];
          if (m < root) m += 12;
          out.add(m);
        }
        return out;
      }

      function startMotif(scale) {
        const len = 3 + Math.floor(rng() * 3); // 3..5 steps
        const steps = [];
        for (let i = 0; i < len; i++) steps.push(Math.floor(rng() * 5) - 2);
        if (steps.every((s) => s === 0)) steps[0] = 1;
        const anchor = state.lastIdx === null
          ? Math.floor(scale.length / 2)
          : Math.max(0, Math.min(scale.length - 1, state.lastIdx + Math.floor(rng() * 5) - 2));
        state.motif = { steps, anchor, cum: 0 };
        state.motifPos = 0;
      }

      // Classical variation: invert, retrograde, transpose, or fragment.
      function developMotif(scale) {
        const m = state.motif;
        const r = rng();
        if (r < 0.25) m.steps = m.steps.map((s) => -s);
        else if (r < 0.5) m.steps = m.steps.slice().reverse();
        else if (r < 0.75) m.anchor = Math.max(0, Math.min(scale.length - 1, m.anchor + 1 + Math.floor(rng() * 3)));
        else m.steps = m.steps.slice(0, 2);
        m.cum = 0;
        state.motifPos = 0;
      }

      function consumeMotif(scale) {
        const step = state.motif.steps[state.motifPos++];
        state.motif.cum += step;
        const deg = Math.max(0, Math.min(scale.length - 1, state.motif.anchor + state.motif.cum));
        return scale[deg];
      }

      // Rule-based note choice: stepwise motion preferred, chord tones and
      // the tonic are magnets, the answer half is pulled below the call's
      // peak, and blue notes (neighbouring off-scale semitones) appear at a
      // rate set by `surprise`.
      function pickNote(scale, scaleSet, offs, chordDeg, tonic, peak, beat, surprise, k) {
        const chord = chordTones(k, offs, chordDeg);
        const pairs = [];
        for (let i = 0; i < scale.length; i++) {
          const m = scale[i];
          const dist = state.lastIdx === null ? 1 : Math.abs(i - state.lastIdx);
          let w;
          if (dist === 0) w = 0.5;
          else if (dist === 1) w = 3.0;
          else if (dist === 2) w = 1.6;
          else if (dist === 3) w = 1.1;
          else if (dist === 4) w = 0.8;
          else w = 0.4;
          if (chord.has(m)) w *= 2.0;
          if (m === tonic) w *= 1.5;
          if (beat >= 4 && peak !== null && m < peak) w *= 1.8;
          pairs.push([m, w]);
        }
        if (state.lastMidi !== null && rng() < 0.04 + 0.22 * surprise) {
          for (const b of [state.lastMidi - 1, state.lastMidi + 1]) {
            if (!scaleSet.has(b) && b >= scale[0] - 1 && b <= scale[scale.length - 1] + 1) pairs.push([b, 0.9]);
          }
        }
        return weightedPick(pairs, rng);
      }

      function nextPhrase() {
        const phraseNo = state.phraseCount;
        state.phraseCount++;
        // Modulation: travel to a different key every 6..12 phrases.
        if (phraseNo >= state.nextModulation) {
          state.keyIdx = (state.keyIdx + 1 + Math.floor(rng() * (KEYS.length - 1))) % KEYS.length;
          state.progression = null;
          state.motif = null;
          state.lastMidi = null;
          state.lastIdx = null;
          state.nextModulation = phraseNo + 6 + Math.floor(rng() * 7);
        }
        const k = key();
        const offs = scaleOffsets();
        if (!state.progression) {
          const table = PROGRESSIONS[k.mode];
          state.progression = table[Math.floor(rng() * table.length)];
        }
        const scale = melodyScale(k, offs);
        const scaleSet = new Set(scale);
        const surprise = rng();
        const timbre = {
          cutoff: Math.round(400 + rng() * 900),
          detune: Math.round((2 + rng() * 5) * 10) / 10,
          triangle: rng() < 0.25,
        };
        const tonic = k.bass + 12;
        const events = [];
        let firstHalfPeak = null;
        if (!state.motif && rng() < 0.6) startMotif(scale);
        for (let beat = 0; beat < 8; beat++) {
          const gb = state.beat + beat;
          const chordDeg = state.progression[Math.floor(gb / 4) % 4];
          // Bass: the chord root, one event per chord change.
          if (gb % 4 === 0) {
            events.push({ beat, midi: k.bass + offs[chordDeg], dur: 4, vel: 0.5, kind: 'bass' });
          }
          const isCadence = beat === 7;
          let rest = false;
          if (!isCadence) {
            if (beat === 0 && rng() < 0.25) rest = true;
            else if (rng() < 0.10 + 0.15 * surprise) rest = true;
          }
          if (rest) continue;
          let midi;
          if (isCadence) {
            // Always land on a chord tone: the next chord's root (anticipation).
            const nextDeg = state.progression[(Math.floor(gb / 4) + 1) % 4];
            midi = k.bass + 12 + offs[nextDeg];
          } else if (state.motif) {
            if (state.motifPos >= state.motif.steps.length) {
              const r = rng();
              if (r < 0.5) startMotif(scale);
              else if (r < 0.8) developMotif(scale);
              else state.motif = null;
            }
            if (state.motif && state.motifPos < state.motif.steps.length) midi = consumeMotif(scale);
            else midi = pickNote(scale, scaleSet, offs, chordDeg, tonic, firstHalfPeak, beat, surprise, k);
          } else {
            midi = pickNote(scale, scaleSet, offs, chordDeg, tonic, firstHalfPeak, beat, surprise, k);
            if (rng() < 0.3) startMotif(scale);
          }
          let dur = weightedPick([[0.5, 0.15], [1, 0.55], [1.5, 0.10], [2, 0.20]], rng);
          if (isCadence) dur = 2;
          let vel = 0.45 + 0.35 * Math.sin(Math.PI * beat / 7);
          if (isCadence) vel *= 0.8;
          let b = beat;
          if (!isCadence && rng() < 0.25 * surprise) b += 0.5; // gentle syncopation
          events.push({ beat: b, midi, dur, vel: Math.round(vel * 100) / 100, kind: 'melody' });
          state.lastMidi = midi;
          state.lastIdx = scale.indexOf(midi);
          if (beat < 4 && (firstHalfPeak === null || midi > firstHalfPeak)) firstHalfPeak = midi;
        }
        state.beat += 8;
        events.sort((a, b) => a.beat - b.beat);
        return {
          events,
          surprise,
          timbre,
          phraseNo,
          key: { mode: k.mode, bass: k.bass, name: k.mode + ' on ' + midiName(k.bass) },
          progression: state.progression.slice(),
        };
      }

      return { nextPhrase, state };
    }

    const VOLUME_STORAGE_KEY = 'agentChirp.volumes.v2';
    const CHAT_COLUMN_SELECTOR = '[data-chat-flow]';
    const CORE_RUNNING_SELECTOR = '[data-chat-running]';
    const INDICATOR_ATTR = 'data-agent-chirp-indicator';
    const HIDE_CSS_ID = 'agent-chirp-hide-core-css';

    // The four distinct sound effects and their popover labels.
    const SOUND_DEFS = [
      { key: 'thinking', label: 'Thinking' },
      { key: 'answering', label: 'Answering' },
      { key: 'tools', label: 'Tools' },
      { key: 'done', label: 'Done chime' },
    ];

    function clamp01(n) { return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }

    // Per-sound volumes. Falls back to `fallback` for any sound not yet stored.
    function readStoredVolumes(fallback) {
      const out = { thinking: fallback, answering: fallback, tools: fallback, done: fallback };
      try {
        const s = localStorage.getItem(VOLUME_STORAGE_KEY);
        if (s !== null) {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed === 'object') {
            for (const k of Object.keys(out)) {
              const n = parseFloat(parsed[k]);
              if (Number.isFinite(n)) out[k] = clamp01(n);
            }
          }
        }
      } catch {}
      return out;
    }

    // Format milliseconds as "[min]m[sec]s" — e.g. 312000 -> "5m12s", 45000 -> "45s".
    function formatDuration(ms) {
      const totalSec = Math.max(0, Math.floor(ms / 1000));
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      if (min > 0) return min + 'm' + sec + 's';
      return sec + 's';
    }

    function createAudioEngine(volumes, intensity) {
      let ctx = null;
      let master = null;
      let currentVolumes = { thinking: 0, answering: 0, tools: 0, done: 0 };
      for (const k of Object.keys(currentVolumes)) currentVolumes[k] = clamp01(volumes[k]);
      let currentIntensity = intensity;
      // Deferred transitions: started only once the AudioContext is actually
      // running (autoplay policy). resume() is asynchronous, so a synchronous
      // ctx.state check right after resume still reads 'suspended'; pending
      // transitions are consumed on the context's statechange event instead.
      let pendingPhase = null;
      let pendingDone = false;
      let onContextState = null;

      function applyPending() {
        if (ctx.state !== 'running') return;
        if (pendingDone) {
          pendingDone = false;
          playDoneChime();
        }
        if (pendingPhase) {
          const p = pendingPhase;
          pendingPhase = null;
          if (p === 'thinking') thinkPad();
          else if (p === 'answering') typeTick();
          else if (p === 'tools') toolTick();
        }
      }

      function ensureCtx() {
        if (!ctx) {
          ctx = new AudioContext();
          master = ctx.createGain();
          master.gain.value = 1; // no global scaling; per-sound volumes applied below
          master.connect(ctx.destination);
          onContextState = () => applyPending();
          ctx.addEventListener('statechange', onContextState);
          applyPending(); // Apply pending if the context is already running.
        }
        if (ctx.state === 'suspended') ctx.resume();
      }

      function setVolume(key, v) {
        currentVolumes[key] = clamp01(v);
      }

      function setPhase(phase) {
        if (phase === 'thinking') thinkPad();
        else if (phase === 'answering') typeTick();
        else if (phase === 'tools') toolTick();
      }

      // Plays the descending done-chime. Caller must guarantee ctx is
      // non-null and running (setPhase/applyPending guard for this).
      function playDoneChime() {
        const peak = 0.10 * Math.max(0.3, currentIntensity) * currentVolumes.done;
        if (peak <= 0.0001) return;
        const t0 = ctx.currentTime + 0.05;
        // Soft bell arpeggio: G5 -> E5 -> D5 -> C5. Each note is a detuned
        // sine pair through a lowpass (no brittle triangle harmonics) with a
        // slow 50 ms attack and a long overlapping release; three decaying,
        // darkening echoes per note fake a reverb tail.
        const NOTES = [783.99, 659.25, 587.33, 523.25];
        const ECHO_DELTAS = [0.21, 0.42, 0.66];
        const ECHO_GAIN = [0.30, 0.16, 0.08];
        const ECHO_CUTOFF = [2400, 1600, 1000];
        NOTES.forEach((f, i) => {
          const t = t0 + i * 0.15;
          for (const detune of [0, 4]) {
            const osc = ctx.createOscillator();
            const lp = ctx.createBiquadFilter();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = f;
            osc.detune.value = detune;
            lp.type = 'lowpass';
            lp.frequency.value = 3200;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(peak, t + 0.05);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 1.65);
            osc.connect(lp).connect(g).connect(master);
            osc.start(t);
            osc.stop(t + 1.7);
          }
          ECHO_DELTAS.forEach((d, e) => {
            const et = t + d + (Math.random() * 0.06 - 0.03);
            const osc = ctx.createOscillator();
            const lp = ctx.createBiquadFilter();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = f;
            lp.type = 'lowpass';
            lp.frequency.value = ECHO_CUTOFF[e];
            g.gain.setValueAtTime(0.0001, et);
            g.gain.exponentialRampToValueAtTime(peak * ECHO_GAIN[e], et + 0.04);
            g.gain.exponentialRampToValueAtTime(0.0001, et + 1.24);
            osc.connect(lp).connect(g).connect(master);
            osc.start(et);
            osc.stop(et + 1.3);
          });
        });
      }

      function done() {
        if (!ctx || ctx.state !== 'running') { pendingDone = true; return; }
        playDoneChime();
      }

      // --- thinking: a composed melody (the Muse) ---
      // One phrase (8 beats) is composed and scheduled per interval tick; the
      // composer keeps its own musical state across phrases.
      const BEAT_MS = 480;
      const PHRASE_BEATS = 8;
      let padTimer = null;
      let composer = null;

      function scheduleMelodyEvent(ev, t0, timbre) {
        const beatSec = BEAT_MS / 1000;
        const t = t0 + ev.beat * beatSec;
        const durSec = ev.dur * beatSec;
        const isBass = ev.kind === 'bass';
        const peak = (isBass ? 0.05 : 0.09) * Math.max(0.2, currentIntensity) * currentVolumes.thinking * ev.vel;
        if (peak <= 0.0001) return; // volume or intensity is zero: stay silent
        const f = midiHz(ev.midi);
        const voices = isBass
          ? [[f, 0, 'sine']]
          : [[f, 0, timbre.triangle ? 'triangle' : 'sine'], [f, timbre.detune, 'sine']];
        for (const [freq, detune, type] of voices) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          osc.detune.value = detune;
          const attack = isBass ? 0.15 : 0.08;
          const release = Math.min(1.2, Math.max(0.3, durSec * 0.9));
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + attack);
          g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
          if (isBass) {
            osc.connect(g).connect(master);
          } else {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = timbre.cutoff;
            osc.connect(lp).connect(g).connect(master);
          }
          osc.start(t);
          osc.stop(t + attack + release + 0.05);
        }
      }

      function thinkPad() {
        ensureCtx();
        if (padTimer) return; // already running
        if (!composer) composer = createComposer();
        const spawnPhrase = () => {
          if (!ctx) return;
          // While the context is suspended the clock is frozen; skip
          // composition so notes do not stack at one instant.
          if (ctx.state !== 'running') return;
          const phrase = composer.nextPhrase();
          const t0 = ctx.currentTime + 0.05;
          for (const ev of phrase.events) scheduleMelodyEvent(ev, t0, phrase.timbre);
        };
        spawnPhrase();
        padTimer = setInterval(spawnPhrase, PHRASE_BEATS * BEAT_MS);
      }

      function stopPad() {
        if (padTimer) { clearInterval(padTimer); padTimer = null; }
      }

      // --- answering: short typewriter-like click bursts ---
      const TYPE_PERIOD_MS = 75;
      let typeTimer = null;
      let noiseBuffer = null;

      function getNoise() {
        if (!noiseBuffer && ctx) {
          const len = Math.floor(ctx.sampleRate * 0.03);
          noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
          const data = noiseBuffer.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        return noiseBuffer;
      }

      function typeTick() {
        ensureCtx();
        if (typeTimer) return;
        const spawnType = () => {
          if (!ctx) return;
          // Sparse clicks so it reads as typing, not machine-gun.
          if (Math.random() < 0.45) return;
          const t = ctx.currentTime;
          const src = ctx.createBufferSource();
          src.buffer = getNoise();
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 2200 + Math.random() * 900;
          bp.Q.value = 1.2;
          const g = ctx.createGain();
          const peak = 0.05 * Math.max(0.3, currentIntensity) * currentVolumes.answering;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
          src.connect(bp).connect(g).connect(master);
          src.start(t);
          src.stop(t + 0.04);
        };
        spawnType();
        typeTimer = setInterval(spawnType, TYPE_PERIOD_MS);
      }

      function stopType() {
        if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
      }

      // --- tools: a brief, higher sine tick, repeated while tools run ---
      const TOOL_PERIOD_MS = 300;
      let toolTimer = null;
      function toolTick() {
        ensureCtx();
        if (toolTimer) return; // already running
        const spawnTool = () => {
          if (!ctx) return;
          const t = ctx.currentTime;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 440;
          const peak = 0.08 * Math.max(0.3, currentIntensity) * currentVolumes.tools;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          osc.connect(g).connect(master);
          osc.start(t);
          osc.stop(t + 0.3);
        };
        spawnTool();
        toolTimer = setInterval(spawnTool, TOOL_PERIOD_MS);
      }
      function stopTool() {
        if (toolTimer) { clearInterval(toolTimer); toolTimer = null; }
      }

      // Stop all ambient loops when leaving a phase.
      function stopAllLoops() {
        stopPad();
        stopType();
        stopTool();
      }

      return {
        resume() { ensureCtx(); },
        setVolume,
        setPhase(phase) {
          stopAllLoops();
          if (phase !== 'idle') pendingDone = false; // new turn started; cancel pending done chime
          if (!ctx || ctx.state !== 'running') { pendingPhase = phase; return; }
          if (phase === 'thinking') thinkPad();
          else if (phase === 'answering') typeTick();
          else if (phase === 'tools') toolTick();
        },
        done,
        onUserInteraction() { ensureCtx(); applyPending(); },
        dispose() {
          stopAllLoops();
          pendingPhase = null; pendingDone = false;
          if (ctx) {
            if (onContextState) { try { ctx.removeEventListener('statechange', onContextState); } catch (_) {} onContextState = null; }
            try { Promise.resolve(ctx.close()).catch(() => {}); } catch (_) {}
            ctx = null; master = null;
          }
        },
      };
    }

    // --- Phase colours & labels (coloured like the previous pill) ---
    const PHASE_COLOR = {
      thinking: '#2dd4a0',
      tools: '#e8a838',
      answering: '#58a6ff',
      idle: '#555',
    };
    const TIME_COLOR = '#a0522d'; // reddish brown (sienna)
    const PHASE_LABEL = {
      thinking: 'Thinking',
      tools: 'Using tools',
      answering: 'Answering',
      idle: 'Chirp',
    };

    // --- Volume popover: one slider per sound effect ---
    function VolumePopover({ volumes, onCommit, onClose, anchor }) {
      const [local, setLocal] = React.useState({ thinking: 0, answering: 0, tools: 0, done: 0, ...volumes });
      const localRef = React.useRef(local);
      localRef.current = local;
      const ref = React.useRef(null);

      React.useEffect(() => {
        const onDocMouseDown = (e) => {
          if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDocMouseDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [onClose]);

      // Position the panel anchored to the icon (above it, right-aligned to the
      // icon's right edge). Fall back to a fixed corner if no anchor is available.
      const popoverStyle = {
        position: 'fixed',
        zIndex: 9999,
        width: 210,
        background: 'var(--dsw-specific-menu)',
        border: '1px solid var(--dsw-alias-border-l3)',
        borderRadius: 10,
        boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 12,
      };
      if (anchor) {
        popoverStyle.right = Math.round(window.innerWidth - anchor.right);
        popoverStyle.bottom = Math.round(window.innerHeight - anchor.top + 8);
      } else {
        popoverStyle.bottom = 64;
        popoverStyle.left = 20;
      }

      const speakerIcon = h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('path', { d: 'M8 2.667 4.417 5.5H2.667A.667.667 0 0 0 2 6.167v3.666a.667.667 0 0 0 .667.667h1.75L8 13.333V2.667Z', fill: 'currentColor' }),
        h('path', { d: 'M10.467 5.72A3.3 3.3 0 0 1 10.467 10.28L11.12 10.9a4.36 4.36 0 0 0 0-6.36l-.653.667Z', fill: 'currentColor' }),
      );

      // One labelled slider row per sound.
      const rows = SOUND_DEFS.map(({ key, label }) => {
        const pct = Math.round(clamp01(local[key]) * 100);
        return h('div', { key, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 600 } }, label),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, fontVariantNumeric: 'tabular-nums' } }, pct + '%'),
          ),
          h('input', {
            type: 'range', min: 0, max: 100, step: 1,
            value: pct,
            onChange: (e) => {
              const v = parseInt(e.target.value, 10) / 100;
              setLocal((prev) => ({ ...prev, [key]: v }));
              localRef.current = { ...localRef.current, [key]: v };
            },
            onMouseUp: () => onCommit(key, clamp01(localRef.current[key])),
            onTouchEnd: () => onCommit(key, clamp01(localRef.current[key])),
            onKeyUp: (e) => { if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') onCommit(key, clamp01(localRef.current[key])); },
            style: { width: '100%', accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
          }),
        );
      });

      return h(React.Fragment, null,
        h('div', {
          onMouseDown: (e) => e.stopPropagation(),
          onClick: (e) => e.stopPropagation(),
          style: { position: 'fixed', inset: 0, zIndex: 9998 },
          onClick: onClose,
        }),
        h('div', {
          ref,
          role: 'dialog',
          'aria-label': 'Chirp volume',
          style: popoverStyle,
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.02em',
            },
          }, h('span', null, 'Chirp volume'), h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500 } }, 'per sound')),
          ...rows,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } },
            speakerIcon,
            h('span', null, 'Applies on release'),
          ),
        ),
      );
    }

    // Inline style for the plugin's own deep-dive indicator element.
    const INDICATOR_CSS =
      'display:none;gap:6px;align-items:center;' +
      'font-size:calc(var(--dsh-content-font-size,14px) - 2px);' +
      'line-height:calc(22px + var(--dsh-content-font-delta, 0px));' +
      'color:var(--dsw-alias-label-deep-diving);' +
      'font-variant-numeric:tabular-nums;margin:6px 0 8px;';

    function AgentChirp({ useProjection, useConversation, useSessionStatus, sessionId }) {
      const projection = useProjection('agentChirp');
      const running = useSessionStatus((s) => s.get(sessionId)?.running === true);
      const liveBlockKind = useConversation((conv) => {
        const chat = conv && conv.views ? conv.views.get('chat') : undefined;
        const partial = chat && chat.legacy ? chat.legacy.partial : null;
        if (!partial || !partial.blocks || partial.blocks.length === 0) return null;
        return partial.blocks[partial.blocks.length - 1].kind;
      });

      const enabled = projection?.enabled !== false;
      const baseVolume = projection?.volume ?? 0.25;
      const intensity = projection?.intensity ?? 0.7;
      const durablePhase = projection?.phase ?? 'idle';
      const effectivePhase = !enabled || !running ? 'idle'
        : liveBlockKind === 'reasoning' ? 'thinking'
        : liveBlockKind === 'text' ? 'answering'
        : liveBlockKind === 'toolCall' ? 'tools'
        : durablePhase;

      const [volumes, setVolumes] = React.useState(() => readStoredVolumes(baseVolume));
      const volumesRef = React.useRef(volumes);
      volumesRef.current = volumes;

      const [popoverOpen, setPopoverOpen] = React.useState(false);
      const [popoverAnchor, setPopoverAnchor] = React.useState(null);
      const pillRef = React.useRef(null);

      const engineRef = React.useRef(null);
      const lastPhaseRef = React.useRef('idle');
      React.useEffect(() => {
        if (!engineRef.current) {
          engineRef.current = createAudioEngine(volumesRef.current, intensity);
          // Resume the AudioContext on any user interaction (autoplay policy).
          document.addEventListener('click', engineRef.current.onUserInteraction);
          document.addEventListener('keydown', engineRef.current.onUserInteraction);
        }
        const phase = effectivePhase;
        if (phase !== lastPhaseRef.current) {
          if (lastPhaseRef.current !== 'idle' && phase === 'idle') engineRef.current.done();
          engineRef.current.setPhase(phase);
          lastPhaseRef.current = phase;
        }
      }, [effectivePhase, intensity]);
      React.useEffect(() => () => {
        if (engineRef.current) {
          document.removeEventListener('click', engineRef.current.onUserInteraction);
          document.removeEventListener('keydown', engineRef.current.onUserInteraction);
          engineRef.current.dispose();
          engineRef.current = null;
        }
      }, []);

      // --- Turn-timing tracking for the deep-dive indicator ---
      const turnStartRef = React.useRef(null);
      const persistedDurationRef = React.useRef(null);
      const runningRef = React.useRef(running);
      runningRef.current = running;
      const phaseRef = React.useRef(effectivePhase);
      phaseRef.current = effectivePhase;
      const enabledRef = React.useRef(enabled);
      enabledRef.current = enabled;

      React.useEffect(() => {
        if (running) {
          turnStartRef.current = Date.now();
          persistedDurationRef.current = null;
        } else if (turnStartRef.current !== null) {
          persistedDurationRef.current = Date.now() - turnStartRef.current;
          turnStartRef.current = null;
        }
      }, [running]);

      // --- Deep-dive indicator rendered at the chat tail ---
      React.useEffect(() => {
        // Hide the core deep-dive indicator (we render our own) when enabled.
        let tag = document.getElementById(HIDE_CSS_ID);
        if (!tag) {
          tag = document.createElement('style');
          tag.id = HIDE_CSS_ID;
          document.head.appendChild(tag);
        }
        tag.textContent = enabledRef.current
          ? CORE_RUNNING_SELECTOR + '{display:none !important;}'
          : '';

        let indicatorEl = null;
        let retryTimer = null;
        let interval = null;

        function makeSpan(attr) {
          const s = document.createElement('span');
          s.setAttribute(attr, '');
          return s;
        }

        function appendIndicator() {
          const column = document.querySelector(CHAT_COLUMN_SELECTOR);
          if (!column) return false;
          indicatorEl = document.createElement('div');
          indicatorEl.setAttribute(INDICATOR_ATTR, '');
          indicatorEl.style.cssText = INDICATOR_CSS;
          indicatorEl.appendChild(makeSpan('data-activity'));
          const timeSpan = makeSpan('data-time');
          timeSpan.style.color = TIME_COLOR;
          indicatorEl.appendChild(timeSpan);
          column.appendChild(indicatorEl);
          return true;
        }

        function updateIndicator() {
          if (!indicatorEl || !indicatorEl.isConnected) {
            // React removed it or the column was replaced (session switch).
            appendIndicator();
            if (!indicatorEl) return;
          }
          if (!enabledRef.current) { indicatorEl.style.display = 'none'; return; }
          const isRunning = runningRef.current;
          const turnStart = turnStartRef.current;
          const persisted = persistedDurationRef.current;
          if (!isRunning && persisted === null) {
            indicatorEl.style.display = 'none';
            return;
          }
          indicatorEl.style.display = 'inline-flex';
          const ms = isRunning ? Date.now() - turnStart : persisted;
          const duration = formatDuration(ms);
          const activityEl = indicatorEl.querySelector('[data-activity]');
          const timeEl = indicatorEl.querySelector('[data-time]');
          if (isRunning) {
            const phase = phaseRef.current;
            activityEl.textContent = PHASE_LABEL[phase];
            activityEl.style.color = PHASE_COLOR[phase];
            activityEl.style.display = '';
          } else {
            activityEl.style.display = 'none';
          }
          timeEl.textContent = duration + ' on this turn';
        }

        if (!appendIndicator()) {
          retryTimer = setInterval(() => {
            if (appendIndicator()) clearInterval(retryTimer);
          }, 100);
        }
        interval = setInterval(updateIndicator, 500);
        updateIndicator();

        return () => {
          if (retryTimer) clearInterval(retryTimer);
          if (interval) clearInterval(interval);
          if (indicatorEl) indicatorEl.remove();
          indicatorEl = null;
        };
      }, [sessionId]);

      // --- Requirement 1: static volume icon ---
      const handleClick = () => {
        if (!popoverOpen) {
          engineRef.current?.resume();
          if (pillRef.current) setPopoverAnchor(pillRef.current.getBoundingClientRect());
          setPopoverOpen(true);
        }
      };
      const commitVolumes = (key, v) => {
        const next = { ...volumesRef.current, [key]: clamp01(v) };
        setVolumes(next);
        try { localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(next)); } catch {}
        engineRef.current?.setVolume(key, clamp01(v));
      };

      const speakerIcon = h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true },
        h('path', { d: 'M8 2.667 4.417 5.5H2.667A.667.667 0 0 0 2 6.167v3.666a.667.667 0 0 0 .667.667h1.75L8 13.333V2.667Z', fill: 'currentColor' }),
        h('path', { d: 'M10.467 5.72A3.3 3.3 0 0 1 10.467 10.28L11.12 10.9a4.36 4.36 0 0 0 0-6.36l-.653.667Z', fill: 'currentColor' }),
      );

      return h('div', {
        ref: pillRef,
        role: 'button',
        tabIndex: 0,
        'aria-label': 'Agent chirp volume',
        onClick: handleClick,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); }
        },
        style: {
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: 7,
          color: 'var(--dsw-alias-label-secondary)',
          cursor: 'pointer',
          border: 'none',
          background: 'transparent',
          padding: 0,
        },
      },
        speakerIcon,
        popoverOpen && h(VolumePopover, {
          volumes,
          onCommit: commitVolumes,
          onClose: () => setPopoverOpen(false),
          anchor: popoverAnchor,
        }),
      );
    }

    function AgentChirpWrapper(props) {
      try {
        return h(AgentChirp, props);
      } catch (err) {
        console.warn('[agent-chirp] render failed:', err);
        return null;
      }
    }

    // Test seam: expose the pure composer for Node-based tests.
    if (typeof window !== 'undefined') {
      window.__agentChirpTest = { createComposer, createAudioEngine, MODES, KEYS, PROGRESSIONS, midiName, midiHz, mulberry32 };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'agent-chirp',
          order: 10,
        }, AgentChirpWrapper));
      },
    };
  },
});
