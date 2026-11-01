# Changelog

## [1.3.0] - 2026-11-01

### Changed
- **The done chime is now a soft bell arpeggio.** The old sound was four
  triangle waves with a 20 ms attack and a 500 ms decay — brittle and
  slightly abrasive. It is replaced by detuned sine pairs through a 3.2 kHz
  lowpass with a 50 ms attack and a 1.65 s overlapping release, plus three
  decaying, darkening echoes per note (2400/1600/1000 Hz lowpass) that fake a
  reverb tail.

## [1.2.0] - 2026-11-01

### Changed
- **Pill colors:** `answering` is now blue (`#58a6ff`), `thinking` is a
  greener teal (`#2dd4a0`), and the turn-time readout is reddish brown
  (`#a0522d`).
- **The thinking sound is now a generated melody instead of a fixed pad.**
  The old sound was a continuous detuned drone plus a deterministic loop of
  six ascending pentatonic notes — it became predictable and tiresome after a
  few minutes. It is replaced by "The Muse", a small procedural composer that
  writes short 8-beat phrases in real time: a two-note bass (chord roots)
  under a stepwise melody, with rotating modes and keys (A and E minor
  pentatonic, D dorian, G mixolydian, A aeolian), 16-beat chord
  progressions, recurring motifs that are inverted, retrograded, and
  transposed when exhausted, cadences that anticipate the next chord,
  weighted stepwise motion with chord-tone and tonic bias, occasional
  off-scale "blue" notes, syncopation, and per-phrase timbre variation
  (filter cutoff, detune, triangle blend). Every phrase is different; the
  seed is random per session. Design document: `docs/thinking-melody.md`.
- **Thinking volume slider now controls the melody.** The same
  `volume.thinking` setting scales the melody's peak gain (bass 0.05, melody
  0.09 at full intensity) in place of the old pad levels.

### Added
- `test/composer.test.mjs` — deterministic-seed reproducibility, 200-phrase
  invariant suite (bass on chord roots, cadence = next chord's root, register
  and velocity bounds, off-scale and stepwise rates, key rotation).
- `test/audio.test.mjs` — drives the audio engine against a mock
  AudioContext and verifies oscillator scheduling, gain ramps, phase
  start/stop, the done-chime, and zero-volume silence.
- `docs/thinking-melody.md` — design document for the melody system.

## [1.1.1] - 2026-11-01

### Fixed
- **Answering and tool-use sounds could be completely silent.** The live
  block kind was read from the wrong data path — `conv.blocks` is `undefined`
  on the `ConversationSnapshot` (the blocks live under
  `conv.views.get('chat').legacy.partial.blocks`), so `liveBlockKind` was
  always `null` and the phase never left the durable `thinking` phase set at
  step start. Only the thinking pad and the done-chime ever played. Restored
  the correct path.
- **Tool-use sound was a single inaudible tick.** `toolTick()` was a one-shot
  440 Hz sine burst with no interval. It now plays a repeating 300 ms tick
  (`setInterval`, matching the previous working reference's continuous tool
  tap) and is stopped via `stopTool()` on phase change — `stopAllLoops()` now
  calls it.
- **Tool-call block kind was matched as kebab-case.** The conversation block
  kind for a tool call is `toolCall` (camelCase, per pi-ai), not `tool-call`,
  so `liveBlockKind === 'tool-call'` never matched and the phase only became
  `tools` via the durable `tool/call` event. Now matched as `'toolCall'`.
- **Autoplay-policy deferral dropped in the v1.1.0 rewrite.** When the
  AudioContext is suspended (browser autoplay policy), phase transitions and
  the done-chime are now deferred and consumed on the context's `statechange`
  event or on the next user interaction (`click`/`keydown`) instead of being
  dropped — restoring the v1.0.1 behaviour that was removed.

## [1.1.0] - 2026-10-15

### Changed
- **Thinking pad is much quieter.** The continuous pad (the "drone") was
  the loudest element of the thinking sound and caused ear fatigue during
  long thinking blocks. Its level dropped from `0.028 × intensity` to
  `0.009 × intensity` (≈ −10 dB), and its slow LFO swell from `0.011` to
  `0.004` to keep the same relative motion. The sparse pentatonic notes are
  unchanged.
- **Done-chime is warmer and more rounded.** Same four notes (G5–E5–D5–C5),
  but each note is now a triangle wave paired with a +6-cent detuned partner
  feeding a lower 1100 Hz low-pass (was 1900 Hz), so the bright upper
  harmonics no longer survive. The attack slowed from 25 ms to 45 ms for a
  rounder onset, and the peak gain dropped from `0.24` to `0.18` to keep the
  overall loudness about the same despite the doubled source.

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
