# Agent Chirp

Gentle musical chirps while your DeepSeek Harness agent works. Agent Chirp
plays a different sound for each phase of an agent turn — a generated melody
while the model thinks, mechanical typewriter clicks while it writes, soft
ticks while tools run, and a bright arpeggio when the turn completes.

## Sounds

| Phase | When | Sound |
|---|---|---|
| thinking | the model is reasoning | a generated short melody — a stepwise tune over a two-note bass, in a rotating set of modes and keys, with motifs, cadences, and occasional blue notes; see [docs/thinking-melody.md](docs/thinking-melody.md) |
| answering | text is streaming in | mechanical typewriter key-clicks — short band-passed noise bursts, ~75 ms apart |
| using tools | tool calls execute | soft, rounded 440 Hz sine ticks every ~300 ms |
| done | the turn ends | a soft descending four-note bell arpeggio (G5–E5–D5–C5) — detuned sine voices through a lowpass, long overlapping tails, and a reverb-like wash of decaying, darkening echoes |

## The pill

Agent Chirp adds a small status pill to the conversation composer dock. It
shows three animated bars and a label — `thinking` (green-teal), `using tools`
(amber), `answering` (blue) — and goes quiet (grey, no animation) between
turns. The turn-time readout is rendered in a reddish brown. Clicking the pill opens a volume popover with a slider and percentage
readout; the chosen volume is remembered in the browser (localStorage) across
restarts.

Because browsers require a user gesture before audio may play, the first click
anywhere (or a key press) also unlocks the audio context. If nothing sounds,
click once.

## Install

Requires a DeepSeek Harness web profile.

```sh
git clone https://github.com/zxbc/agent-chirp.git
cd agent-chirp
npm install            # installs zod for the host half
dsh plugin --profile web add ./agent-chirp
```

(`dsh plugin` is a pnpm pass-through, so a path argument installs the bundle
by link.) Reload the web UI afterwards.

## Configuration

The plugin ships with defaults via its `cordis.patch.yml` overlay:

```yaml
- insert:
    - id: agent-chirp
      name: '@local/agent-chirp'
      config:
        enabled: true    # false silences the plugin entirely
        volume: 0.25     # master loudness, 0–1 (the pill slider overrides it per browser)
        intensity: 0.7   # per-sound loudness multiplier, 0–1
```

Override the entry in your profile's patch layer to change the defaults.

## How it works

**Host half (`index.js`)** — registers a session projection `agentChirp`
that reduces durable session events into a phase
(`thinking` / `tools` / `answering` / `idle`):

- `turn/start`, `step/start` → `thinking`
- `tool/call` → `tools` (the call→result window, so tool use is prominent)
- `tool/result` → `thinking` (the model processes the result)
- `assistant/message`, `assistant/attempt` → inspects the stream record:
  text chunks → `answering`, tool-call chunks → `tools`
- `turn/end` → `idle`

It also listens to the live `agent/assistant-stream` frames
(`reasoning-delta` / `text-delta` / `tool-call-delta`) so the phase is
correct *between* durable events, and exposes the live phase via
`harness.handle('getLivePhase')`. The projection state is schema-validated
with [zod](https://zod.dev) (`stateVersion: 2`).

**Client half (`client.js`)** — a small WebAudio engine (oscillators plus a
band-passed noise buffer; nothing downloaded, zero dependencies) renders each
phase with the sounds above. Phase resolution on each tick:

1. the conversation view's streaming partial (reasoning / text / tool-call
   block kind) — real time;
2. otherwise the durable projection, gated by the session's unified status so
   sounds start at turn start and **stop the instant the turn ends**;
3. otherwise idle.

The engine fades pads out with short gain ramps instead of cutting
oscillators mid-sample (that was the loud pop), defers all audio until the
AudioContext is running, and applies volume changes to the running engine
without restarting it.

## Files

```
index.js            host half: session projection + stream listener
client.js           client half: WebAudio engine + status pill
cordis.patch.yml    default config overlay
locale/en.json      plugin-manager title/description
icon.svg            plugin icon
```

## License

MIT — see [LICENSE](LICENSE).
