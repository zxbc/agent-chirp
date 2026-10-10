window.__ModuleLoader__.load({
  id: '@local/agent-chirp',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // --- Pentatonic scales ---
    // Low, warm scale for thinking; bright high scale for answering.
    const SCALE_LOW = [196.0, 220.0, 261.63, 293.66, 329.63, 392.0];
    const SCALE_HIGH = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

    const VOLUME_STORAGE_KEY = 'agentChirp.volume';

    function readStoredVolume(fallback) {
      try {
        const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
        if (raw !== null) {
          const v = parseFloat(raw);
          if (!isNaN(v) && v >= 0 && v <= 1) return v;
        }
      } catch (_) { /* storage unavailable */ }
      return fallback;
    }

    function storeVolume(v) {
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(v));
      } catch (_) { /* storage unavailable */ }
    }

    // --- Audio engine ---
    function createAudioEngine(volume, intensity) {
      let ctx = null;
      let masterGain = null;
      let currentVolume = volume;
      let padOsc = null;
      let padGain = null;
      let padLfo = null;
      let padLfoGain = null;
      let timer = null;
      let currentPhase = 'idle';
      let pendingPhase = null;
      let noiseBuffer = null;

      function ensureContext() {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          masterGain = ctx.createGain();
          masterGain.gain.value = currentVolume;
          masterGain.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        return ctx;
      }

      function setVolume(v) {
        currentVolume = v;
        if (masterGain) {
          masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
        }
      }

      // Fade the pad out before stopping/disconnecting so leaving "thinking"
      // doesn't cut the sine wave mid-sample (the abrupt stop was the loud pop).
      function stopPad() {
        if (!padOsc) return;
        const now = ctx ? ctx.currentTime : 0;
        if (padGain) {
          try {
            padGain.gain.cancelScheduledValues(now);
            padGain.gain.setTargetAtTime(0, now, 0.04);
          } catch (_) {}
        }
        try { padOsc.stop(now + 0.18); } catch (_) {}
        try { padLfo.stop(now + 0.18); } catch (_) {}
        const osc = padOsc, gain = padGain, lfo = padLfo, lfoGain = padLfoGain;
        padOsc = null; padGain = null; padLfo = null; padLfoGain = null;
        setTimeout(() => {
          try { osc.disconnect(); } catch (_) {}
          try { gain.disconnect(); } catch (_) {}
          try { lfo.disconnect(); } catch (_) {}
          try { lfoGain.disconnect(); } catch (_) {}
        }, 220);
      }

      // Gentle ambient bed for "thinking": a warm low tone with a slow,
      // subtle LFO — calm and airy rather than droney.
      function startThinkingPad() {
        const c = ensureContext();
        stopPad();
        padOsc = c.createOscillator();
        padOsc.type = 'sine';
        padOsc.frequency.value = 146.83; // D3 — soft, warm
        padGain = c.createGain();
        padGain.gain.value = 0;
        padGain.gain.setTargetAtTime(0.055 * intensity, c.currentTime, 0.4);
        padLfo = c.createOscillator();
        padLfo.frequency.value = 0.25; // slower, gentler swell
        padLfoGain = c.createGain();
        padLfoGain.gain.value = 0.02;
        padLfo.connect(padLfoGain);
        padLfoGain.connect(padGain.gain);
        padOsc.connect(padGain);
        padGain.connect(masterGain);
        padOsc.start();
        padLfo.start();
      }

      // Soft, sparse low note — a calm "hmm" while thinking.
      function playThinkingNote() {
        const c = ensureContext();
        const osc = c.createOscillator();
        const gain = c.createGain();
        const scaleIdx = Math.floor(Math.random() * SCALE_LOW.length);
        osc.frequency.value = SCALE_LOW[scaleIdx] * (1 + (Math.random() - 0.5) * 0.04);
        osc.type = 'sine';
        const now = c.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.14 * intensity, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.8);
      }

      // Lazily build a short noise buffer for percussive clicks.
      function getNoiseBuffer() {
        const c = ensureContext();
        if (!noiseBuffer) {
          const len = Math.floor(c.sampleRate * 0.04);
          noiseBuffer = c.createBuffer(1, len, c.sampleRate);
          const data = noiseBuffer.getChannelData(0);
          for (let i = 0; i < len; i++) {
            // Sharp attack, fast exponential-ish decay — a key strike.
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
          }
        }
        return noiseBuffer;
      }

      // Typewriter key click — short filtered noise burst with random pitch,
      // fired rapidly while text streams. Mechanical, not tonal.
      function playTypewriterClick() {
        const c = ensureContext();
        const source = c.createBufferSource();
        source.buffer = getNoiseBuffer();
        source.playbackRate.value = 0.85 + Math.random() * 0.5;
        const filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2200 + Math.random() * 1800;
        filter.Q.value = 1.2;
        const gain = c.createGain();
        const now = c.currentTime;
        gain.gain.setValueAtTime(0.20 * intensity, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        source.start(now);
        source.stop(now + 0.04);
      }

      // Soft, rounded tick — gentle mechanical pulse while tools run,
      // balanced with the thinking pad/note rather than harsh or loud.
      function playToolTap() {
        const c = ensureContext();
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.frequency.value = 440;
        osc.type = 'sine';
        const now = c.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.11 * intensity, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.14);
      }

      // Bright ascending chime — a loud, clear "all done" conclusion.
      // Three-note major arpeggio (C5-E5-G5) with a final C6 sparkle.
      function playDoneChime() {
        const c = ensureContext();
        const now = c.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.frequency.value = freq;
          osc.type = 'sine';
          const t = now + i * 0.11;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.38 * intensity, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          osc.connect(gain);
          gain.connect(masterGain);
          osc.start(t);
          osc.stop(t + 0.6);
        });
      }

      function clearTimer() {
        if (timer) { clearInterval(timer); timer = null; }
      }

      // Start the audio for a phase. Only called when the AudioContext is
      // running, so nothing is scheduled while suspended (scheduling during
      // suspension and bursting on resume was a pop source).
      function startPhaseAudio(phase, prev) {
        if (phase === 'thinking') {
          startThinkingPad();
          timer = setInterval(playThinkingNote, 1400);
        } else if (phase === 'answering') {
          stopPad();
          playTypewriterClick();
          timer = setInterval(playTypewriterClick, 75);
        } else if (phase === 'tools') {
          stopPad();
          playToolTap();
          timer = setInterval(playToolTap, 300);
        } else if (phase === 'idle') {
          stopPad();
          if (prev !== 'idle') playDoneChime();
        }
      }

      function setPhase(phase) {
        if (phase === currentPhase) return;
        const prev = currentPhase;
        currentPhase = phase;
        clearTimer();
        // Defer audio until the context is actually running (user gesture).
        if (!ctx || ctx.state !== 'running') {
          pendingPhase = phase;
          return;
        }
        startPhaseAudio(phase, prev);
      }

      function onUserInteraction() {
        ensureContext();
        if (pendingPhase && ctx && ctx.state === 'running') {
          const p = pendingPhase;
          pendingPhase = null;
          startPhaseAudio(p, 'idle');
        }
      }

      return {
        setPhase,
        setVolume,
        getVolume: () => currentVolume,
        dispose: () => { clearTimer(); stopPad(); },
        onUserInteraction,
      };
    }

    // --- Volume popover ---
    function VolumePopover({ volume, onChange }) {
      const pct = Math.round(volume * 100);

      return h('div', {
        style: {
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderRadius: '10px',
          backgroundColor: 'var(--dsw-alias-bg-raised, rgba(30,30,30,0.95))',
          border: '1px solid var(--dsw-alias-border-base, rgba(128,128,128,0.25))',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 100,
          backdropFilter: 'blur(8px)',
        },
      },
        // Speaker icon
        h('svg', {
          width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none',
          stroke: 'var(--dsw-alias-label-primary, #ccc)', strokeWidth: '2',
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          h('polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }),
          pct > 0 ? h('path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }) : null,
          pct > 50 ? h('path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }) : null
        ),
        h('input', {
          type: 'range',
          min: '0',
          max: '100',
          value: pct,
          onChange: (e) => onChange(parseInt(e.target.value, 10) / 100),
          style: {
            width: '100px',
            height: '4px',
            appearance: 'none',
            WebkitAppearance: 'none',
            backgroundColor: 'var(--dsw-alias-border-base, rgba(128,128,128,0.3))',
            borderRadius: '2px',
            outline: 'none',
            cursor: 'pointer',
            accentColor: '#7ec8e3',
          },
        }),
        h('span', {
          style: {
            fontSize: '11px',
            fontWeight: 500,
            color: 'var(--dsw-alias-label-secondary, #aaa)',
            minWidth: '32px',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          },
        }, pct + '%')
      );
    }

    // --- Component ---
    function AgentChirp(props) {
      const { useProjection, useConversation, useSessionStatus, sessionId } = props;

      const projection = useProjection('agentChirp');
      const durablePhase = projection ? projection.phase : 'idle';
      const configVolume = projection ? projection.volume : 0.25;
      const intensity = projection ? projection.intensity : 0.7;
      const enabled = projection ? projection.enabled : true;

      // Real-time turn activity from the unified session status. `running`
      // flips true at turn start and false at turn end as soon as the
      // gateway reports it — the same signal the harness's own "Deep
      // diving" indicator uses — so sounds start/stop with the actual turn
      // instead of waiting for durable projection commits.
      const running = useSessionStatus((status) => {
        if (!sessionId) return false;
        const entry = status.get(sessionId);
        return !!entry && entry.running === true;
      });

      // Best-effort live phase from the chat view's streaming partial. When
      // the conversation views store exposes the partial, its last block
      // kind reflects what the model is doing right now (reasoning →
      // thinking, text → answering, tool-call → tools). This is consulted
      // before the durable projection; when it is null we fall back to the
      // durable phase, which is still correct for turn start/stop because
      // `running` gates those transitions in real time.
      const liveBlockKind = useConversation((conv) => {
        const chat = conv && conv.views ? conv.views.get('chat') : undefined;
        const partial = chat && chat.legacy ? chat.legacy.partial : null;
        if (!partial || !partial.blocks || partial.blocks.length === 0) return null;
        return partial.blocks[partial.blocks.length - 1].kind;
      });

      // Volume: user-adjustable, persisted in localStorage.
      const [volume, setVolume] = React.useState(() => readStoredVolume(configVolume));
      const [popoverOpen, setPopoverOpen] = React.useState(false);

      const engineRef = React.useRef(null);
      const wrapperRef = React.useRef(null);
      const enabledRef = React.useRef(enabled);
      enabledRef.current = enabled;

      // When config volume changes (e.g. plugin reconfigured), sync if user
      // hasn't overridden it.
      React.useEffect(() => {
        setVolume(readStoredVolume(configVolume));
      }, [configVolume]);

      // Keep the latest volume in a ref so the engine-creation effect (which
      // runs once) can read it without depending on it.
      const volumeRef = React.useRef(volume);
      volumeRef.current = volume;

      // Close the popover on outside click (the wrapper contains both the pill
      // and the popover, so clicks on either are ignored).
      React.useEffect(() => {
        if (!popoverOpen) return;
        function handleOutsideClick(e) {
          if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
            setPopoverOpen(false);
          }
        }
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
      }, [popoverOpen]);

      React.useEffect(() => {
        const engine = createAudioEngine(volumeRef.current, intensity);
        engineRef.current = engine;
        document.addEventListener('click', engine.onUserInteraction);
        document.addEventListener('keydown', engine.onUserInteraction);
        return () => {
          document.removeEventListener('click', engine.onUserInteraction);
          document.removeEventListener('keydown', engine.onUserInteraction);
          engine.dispose();
          engineRef.current = null;
        };
      }, [intensity]);

      // Apply volume changes to the running engine without recreating it
      // (so an active thinking pad doesn't restart mid-drag).
      React.useEffect(() => {
        if (engineRef.current) {
          engineRef.current.setVolume(volume);
        }
      }, [volume]);

      // Effective phase, in priority order:
      //  1. Live partial block kind — real-time thinking/answering/tools
      //     while the stream is exposed through the conversation views.
      //  2. Durable projection phase — correct at turn boundaries because
      //     `running` (real-time) gates whether we're in a turn at all.
      //  3. Idle — when no turn is running, sounds stop immediately instead
      //     of waiting for a durable turn/end commit.
      let effectivePhase;
      if (!enabled) {
        effectivePhase = 'idle';
      } else if (liveBlockKind === 'reasoning') {
        effectivePhase = 'thinking';
      } else if (liveBlockKind === 'text') {
        effectivePhase = 'answering';
      } else if (liveBlockKind === 'tool-call') {
        effectivePhase = 'tools';
      } else if (running) {
        effectivePhase = durablePhase;
      } else {
        effectivePhase = 'idle';
      }

      React.useEffect(() => {
        if (engineRef.current) {
          engineRef.current.setPhase(effectivePhase);
        }
      }, [effectivePhase]);

      const phaseLabel = effectivePhase === 'thinking' ? 'thinking'
        : effectivePhase === 'tools' ? 'using tools'
        : effectivePhase === 'answering' ? 'answering'
        : 'chirp';
      const barColor = effectivePhase === 'tools' ? '#e8a838'
        : effectivePhase === 'answering' ? '#5ee6a8'
        : effectivePhase === 'thinking' ? '#7ec8e3'
        : '#555';

      function handleVolumeChange(v) {
        setVolume(v);
        storeVolume(v);
      }

      function handlePillClick(e) {
        e.stopPropagation();
        setPopoverOpen((open) => !open);
      }

      return h('div', {
        ref: wrapperRef,
        style: { position: 'relative', display: 'inline-flex' },
      },
        h('div', {
          onClick: handlePillClick,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '12px',
            backgroundColor: effectivePhase === 'idle' ? 'transparent' : 'var(--dsw-alias-bg-base, rgba(128,128,128,0.1))',
            border: '1px solid ' + (effectivePhase === 'idle' ? 'transparent' : barColor + '44'),
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            userSelect: 'none',
          },
          'aria-label': 'Agent activity: ' + phaseLabel + '. Click to adjust volume.',
          title: 'Agent Chirp — ' + phaseLabel + ' (click to adjust volume)',
        },
          h('div', {
            style: { display: 'flex', alignItems: 'flex-end', gap: '2px', height: '14px' },
          },
            [0, 1, 2].map((i) =>
              h('div', {
                key: i,
                style: {
                  width: '4px',
                  height: effectivePhase === 'idle' ? '5px' : (7 + i * 3) + 'px',
                  backgroundColor: barColor,
                  borderRadius: '2px',
                  transition: 'height 0.3s ease, background-color 0.3s ease',
                  animation: effectivePhase !== 'idle' ? 'chirp-bar ' + (0.6 + i * 0.15) + 's ease-in-out infinite alternate' : 'none',
                },
              })
            )
          ),
          h('span', {
            style: {
              fontSize: '11px',
              fontWeight: 500,
              color: effectivePhase === 'idle' ? 'var(--dsw-alias-label-tertiary, #888)' : barColor,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
            },
          }, phaseLabel)
        ),
        popoverOpen
          ? h(VolumePopover, {
              volume,
              onChange: handleVolumeChange,
            })
          : null
      );
    }

    function StyleInjector() {
      const css = [
        '@keyframes chirp-bar { 0% { transform: scaleY(0.6); } 100% { transform: scaleY(1.2); } }',
        'input[type="range"]::-webkit-slider-thumb {',
        '  -webkit-appearance: none;',
        '  appearance: none;',
        '  width: 12px;',
        '  height: 12px;',
        '  border-radius: 50%;',
        '  background: #7ec8e3;',
        '  cursor: pointer;',
        '  border: none;',
        '}',
        'input[type="range"]::-moz-range-thumb {',
        '  width: 12px;',
        '  height: 12px;',
        '  border-radius: 50%;',
        '  background: #7ec8e3;',
        '  cursor: pointer;',
        '  border: none;',
        '}',
      ].join('\n');
      return h('style', { dangerouslySetInnerHTML: { __html: css } });
    }

    function AgentChirpWrapper(props) {
      return h(React.Fragment, null, h(StyleInjector, null), h(AgentChirp, props));
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
