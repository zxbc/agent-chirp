# Changelog

## [1.0.1] - 2026-10-12

### Fixed
- **Thinking pad could play indefinitely after a turn ended** (intermittent, and
  it survived opening a new session). Two root causes in `client.js`:
  - The AudioContext `resume()` is asynchronous, but the deferred phase was only
    re-checked inside the click/keydown handler with a synchronous
    `ctx.state === 'running'` test — which still read `'suspended'`. When a
    turn ended while the context was suspended, the `idle` transition was
    deferred and never applied, so the thinking pad (already scheduled) kept
    sounding after resume, forever. The pending transition is now consumed on
    the context's `statechange` event, and a stale pending transition (UI moved
    on while suspended) is dropped instead of started — starting it would
    create a sound no later `setPhase` could stop.
  - The live streaming partial was consulted **before** the real-time
    `running` flag. The conversation view retains the last streamed partial
    after the turn ends, so a lingering final block could pin the phase to
    `thinking` (or `answering`) indefinitely. The phase now resolves to idle
    immediately whenever no turn is running; the live block kind is only
    consulted while `running` is true.
- The deferred `idle` transition now keeps its `prev` phase, so the done-chime
  still plays (slightly late) when it is finally applied after a suspend.
- `dispose()` now closes the AudioContext and removes its `statechange`
  listener, so contexts no longer accumulate across component remounts
  (session switches), and late `statechange` events after unmount are inert.
- `startPhaseAudio()` now defensively clears any existing interval before
  arming a new one, so a leaked interval can never keep firing notes.

## [1.0.0] - 2026-10-10

Initial release.

### Added
- Phase-aware ambient audio for agent turns:
  - **thinking** — warm D3 ambient pad with a slow LFO swell, plus sparse soft
    low pentatonic notes (±2% detune, ~1.4 s apart)
  - **answering** — mechanical typewriter key-clicks (band-passed noise
    bursts, ~75 ms apart)
  - **using tools** — soft rounded 440 Hz sine ticks (~300 ms apart)
  - **turn end** — bright four-note major arpeggio chime (C5–E5–G5–C6)
- Real-time phase detection from streaming deltas (reasoning / text /
  tool-call) with a durable session-projection fallback; sounds stop the
  instant the turn ends.
- Status pill in the conversation composer dock: animated bars, phase label
  and color, click-to-open volume popover with slider; volume persisted to
  localStorage.
- Configuration via cordis patch overlay: `enabled`, `volume`
  (default 0.25), `intensity` (default 0.7).
