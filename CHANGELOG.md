# Changelog

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
