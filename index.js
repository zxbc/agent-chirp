import { z } from 'zod';

export const inject = ['sessionProjections'];

export function apply(ctx, config = {}) {
  const volume = config.volume ?? 0.25;
  const intensity = config.intensity ?? 0.7;
  const enabled = config.enabled ?? true;

  // --- Live streaming phase (real-time, from agent/assistant-stream) ---
  // 'thinking' while reasoning tokens stream, 'answering' while text tokens
  // stream, null when no stream is active (fall back to durable projection).
  let livePhase = null;
  let streamActive = false;
  let streamEventsSeen = 0;
  let lastChunkType = null;

  const offStream = ctx.on('agent/assistant-stream', (payload) => {
    const frame = payload?.frame;
    if (!frame) return;
    streamEventsSeen++;
    if (frame.type === 'chunk') {
      const chunk = frame.chunk;
      lastChunkType = chunk?.type ?? null;
      if (chunk.type === 'reasoning-delta') {
        livePhase = 'thinking';
        streamActive = true;
      } else if (chunk.type === 'text-delta') {
        livePhase = 'answering';
        streamActive = true;
      } else if (chunk.type === 'tool-call-delta') {
        // Model is emitting tool calls; tools will run shortly.
        livePhase = 'tools';
        streamActive = true;
      }
      // block-start / block-end / usage chunks don't change the phase.
    } else if (frame.type === 'end') {
      // Stream ended; the durable projection (assistant/attempt, tool/call,
      // turn/end) takes over within milliseconds. Keep livePhase until then.
      streamActive = false;
    }
  });

  // --- Durable phase from session events ---
  ctx.sessionProjections.register({
    key: 'agentChirp',
    stateVersion: 2,
    stateSchema: z.object({
      phase: z.enum(['idle', 'thinking', 'tools', 'answering']),
      lastChangeAt: z.number(),
    }),
    init: () => ({
      phase: 'idle',
      lastChangeAt: 0,
    }),
    apply(state, event) {
      switch (event.type) {
        case 'turn/start':
        case 'step/start':
          // Model begins generating; default to thinking until stream data
          // or the attempt record refines it.
          return { phase: 'thinking', lastChangeAt: Date.now() };
        case 'tool/call':
          // Tool execution begins — this is the prominent "using tools"
          // window (call → result), fixing the old brief-flash bug.
          return { phase: 'tools', lastChangeAt: Date.now() };
        case 'tool/result':
          // Model processes the result and generates again.
          return { phase: 'thinking', lastChangeAt: Date.now() };
        case 'assistant/message':
        case 'assistant/attempt': {
          // Generation completed (message = successful response, attempt =
          // failed/retried). Inspect the stream record to label the phase
          // that just finished (and seed the next one).
          const stream = event.data?.stream ?? [];
          let phase = 'thinking';
          for (const rec of stream) {
            if (rec.type === 'text-chunks') {
              phase = 'answering';
            } else if (rec.type === 'tool-call-chunks') {
              phase = 'tools';
            }
          }
          return { phase, lastChangeAt: Date.now() };
        }
        case 'turn/end':
          return { phase: 'idle', lastChangeAt: Date.now() };
        default:
          return state;
      }
    },
    wire: {
      viewSchema: z.object({
        phase: z.enum(['idle', 'thinking', 'tools', 'answering']),
        lastChangeAt: z.number(),
        volume: z.number(),
        intensity: z.number(),
        enabled: z.boolean(),
      }),
      view(state) {
        return {
          phase: enabled ? state.phase : 'idle',
          lastChangeAt: state.lastChangeAt,
          volume,
          intensity,
          enabled,
        };
      },
    },
  });

  // --- Real-time live phase for the client to poll ---
  // The projection only updates on session events; this handler exposes the
  // streaming phase between events so thinking vs answering is distinct live.
  // Wrapped in try/catch: if harness.handle is unavailable, the durable
  // projection still works (thinking/answering just won't be distinguished
  // in real time).
  try {
    harness.handle('getLivePhase', () => {
      return {
        phase: streamActive ? livePhase : null,
        enabled,
        // Diagnostics: help verify the stream listener is firing.
        streamEventsSeen,
        lastChunkType,
      };
    });
  } catch (err) {
    // harness.handle not available in this sandbox; projection-only mode.
    console.warn('[agent-chirp] harness.handle unavailable, real-time phase disabled:', err?.message ?? err);
  }

  return () => {
    offStream();
  };
}
