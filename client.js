window.__ModuleLoader__.load({
  id: '@local/agent-chirp',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // --- Pentatonic scales ---
    // Low, warm scale for thinking; bright high scale for answering.
    const SCALE_LOW = [196.0, 220.0, 261.63, 293.66, 329.63, 392.0];
    const SCALE_HIGH = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

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
        const t0 = ctx.currentTime + 0.05;
        // Descending arpeggio: G5 -> E5 -> D5 -> C5, gentle triangle, quick decay.
        [783.99, 659.25, 587.33, 523.25].forEach((f, i) => {
          const t = t0 + i * 0.12;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.12 * Math.max(0.3, currentIntensity) * currentVolumes.done, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          osc.connect(g).connect(master);
          osc.start(t);
          osc.stop(t + 0.6);
        });
      }

      function done() {
        if (!ctx || ctx.state !== 'running') { pendingDone = true; return; }
        playDoneChime();
      }

      // --- thinking: a warm sustained pad with a slow swell ---
      const PAD_PERIOD_MS = 1400;
      let padTimer = null;
      let padNoteCount = 0;

      function thinkPad() {
        ensureCtx();
        if (padTimer) return; // already running
        const spawnPad = () => {
          if (!ctx) return;
          // Sparse: ~70% chance per period to keep it calm.
          if (Math.random() < 0.3) return;
          const t = ctx.currentTime;
          const base = SCALE_LOW[padNoteCount % SCALE_LOW.length];
          padNoteCount++;
          // Two slightly detuned oscillators for a warm chord tone.
          [base, base * 1.5].forEach((f, idx) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = f * (1 + (idx === 0 ? 0.003 : -0.003));
            const peak = (idx === 0 ? 0.10 : 0.05) * Math.max(0.2, currentIntensity) * currentVolumes.thinking;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(peak, t + 0.5);
            g.gain.linearRampToValueAtTime(0.0001, t + 1.25);
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 900;
            osc.connect(lp).connect(g).connect(master);
            osc.start(t);
            osc.stop(t + 1.3);
          });
        };
        spawnPad();
        padTimer = setInterval(spawnPad, PAD_PERIOD_MS);
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
      thinking: '#2dd4bf',
      tools: '#e8a838',
      answering: '#5ee6a8',
      idle: '#555',
    };
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
          indicatorEl.appendChild(makeSpan('data-time'));
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
