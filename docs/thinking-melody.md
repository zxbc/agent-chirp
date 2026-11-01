# The Thinking Melody — Design Document

The "thinking" sound is the audio that plays while the agent's reasoning tokens
stream. Version 1.x played a **deterministic ascending loop**: the six notes of
a G-major pentatonic scale (G3 A3 C4 D4 E4 G4) cycled in order every 1.4 s.
After a few seconds it is predictable and tires the ear.

This document describes the replacement: a small **procedural composer**
(working name *the Muse*) that generates a different, musically coherent
melody every phrase, so the sound never loops identically.

## 1. Goals and constraints

- **Varied**: no two phrases sound the same; a long thinking session never
  becomes a repeating loop.
- **Coherent**: it must sound *composed*, not like random noise. Every note is
  chosen by musical rules (scale, harmony, voice leading), never by pure
  chance.
- **Calm**: it is an ambient indicator, not music to listen to. Dynamics stay
  soft, the register stays low and warm, and most beats are rests or quiet
  passing tones.
- **Self-contained**: pure JavaScript inside `client.js`, no dependencies, no
  audio files. Everything is synthesized with the Web Audio API.
- **Drop-in**: the public surface (`thinkPad()` / `stopPad()`, per-sound
  volume, intensity scaling, autoplay-policy deferral) is unchanged.

## 2. Architecture

```
thinkPad()  ──interval every phrase (8 beats)──►  composer.nextPhrase()
                                                        │
                                                        ▼
                                          events: [{beat, midi, dur, vel, kind}]
                                                        │
                                                        ▼
                                          Web Audio scheduling (osc + filter
                                          + gain envelope per event)
```

The composer is a **pure function of an RNG** — no Web Audio, no DOM — so it
can be run headless in Node for testing (`test/composer.test.mjs`). The audio
engine only turns events into oscillators.

Time base: **1 beat = 480 ms**, **1 phrase = 8 beats** (3.84 s), **1 chord =
4 beats**. A phrase therefore spans two chords of a four-chord progression.

## 3. Layer 0 — Key and mode

On startup (and on every modulation, §9) the composer picks a **key** from a
curated set of contemplative modes. Each key names a mode and a bass root; the
melody register is the two octaves above the bass root (`root+12 … root+34`
semitones), the bass register is the root itself.

| Key             | Mode         | Bass root | Melody register |
|-----------------|--------------|-----------|-----------------|
| A minor pent.   | `minorPent`  | A2 (45)   | A3 – G5         |
| E minor pent.   | `minorPent`  | E2 (40)   | E3 – E5         |
| D Dorian        | `dorian`     | D2 (38)   | D3 – D5         |
| G Mixolydian    | `mixolydian` | G2 (43)   | G3 – G5         |
| A Aeolian       | `aeolian`    | A2 (45)   | A3 – G5         |

Modes are stored as semitone offsets from the root, e.g.
`dorian = [0, 2, 3, 5, 7, 9, 10]`. Pentatonic keys are included because they
can never clash harmonically; Dorian/Mixolydian/Aeolian add colour (the
Dorian sixth, the Mixolydian flat-seventh, the Aeolian minor third).

## 4. Layer 1 — Harmonic movement (chord progressions)

A **progression** is four chords, each lasting 4 beats (two phrases).
Progressions are chosen from a per-mode table of *calm* patterns, expressed as
0-based scale degrees:

```
minorPent:  i–v–VII–iv        i–VII–v–iv        v–VII–i–iv        i–iv–v–VII
dorian:     i–VII–iv–v      i–iii–iv–i      i–iv–v–i        VII–iv–v–VII
mixolydian: I–IV–VII–IV     I–VI–IV–I       I–iii–IV–I      IV–VII–IV–VII
aeolian:    i–VI–III–VII    i–iv–v–i        i–VII–VI–VII    VI–III–VII–VI
```

A chord on scale degree *d* is the diatonic triad `d, d+2, d+4` (mod the
scale length), so e.g. degree 0 of A-minor-pentatonic is A–C–E. In pentatonic
keys the triads may be incomplete (no third in the scale) — they then read as
suspended/root-fifth colours, which is fine for an ambient pad.

The current chord at any beat is `progression[floor(beat / 4) % 4]`. Chord
tones act as **magnets** for the melodic note chooser (§5) and supply the bass
note (§8).

## 5. Layer 2 — Melodic note selection (rule engine)

For each beat that is not a rest, the next pitch is chosen from **all scale
notes in the melody register**, each weighted by musical rules:

| Rule                                    | Weight |
|-----------------------------------------|--------|
| Repeat of previous note                 | 0.5    |
| Step of 1 scale degree                  | 3.0    |
| Step of 2 scale degrees (a third)       | 1.6    |
| Step of 3 scale degrees (a fifth)       | 1.1    |
| Step of 4 scale degrees                 | 0.8    |
| Leap of 5+ scale degrees                | 0.4    |
| × 2.0 if the candidate is a chord tone  |        |
| × 1.5 if the candidate is the tonic     |        |
| × 1.8 (beats 4–7 only) if below the first-half peak — "answer" gravity, §7 | |

Distance is measured in **scale degrees**, not semitones, so a "step" means a
neighbouring scale note in any mode. The result is a melody that mostly moves
by step, gravitates to chord tones and the tonic, and only occasionally leaps.

**Blue notes.** With probability `0.04 + 0.22 × surprise` (§6), one or two
*neighbouring semitones* of the previous note that are **outside the scale**
are added as candidates at weight 0.9. These passing colour notes (a flat-six
against a Dorian chord, a sharp-four against Mixolydian, …) are what make the
melody feel human rather than robotic — but they are always passing tones,
never the cadence note.

## 6. The surprise parameter

Each phrase draws a `surprise` value in `[0, 1]` from the RNG. It modulates:

- rest probability: `0.10 + 0.15 × surprise`
- blue-note probability: `0.04 + 0.22 × surprise`
- rhythmic displacement: with probability `0.25 × surprise`, a note is
  delayed by half a beat (a gentle syncopation)

A low-surprise phrase is sparse and settled; a high-surprise phrase is
busier, more colourful, more syncopated. Because surprise is re-drawn every
phrase, the *character* of the music drifts continuously.

## 7. Layer 3 — Phrase form: call and response

An 8-beat phrase is a **call** (beats 0–3) and an **answer** (beats 4–7):

- **Beat 0** is a rest with probability 0.25 — a breath before the call.
- The **call** establishes a peak: the highest scale degree reached in
  beats 0–3 is recorded as `firstHalfPeak`.
- The **answer** is pulled *down* from that peak: on beats 4–7, candidates
  below `firstHalfPeak` get the ×1.8 weight of §5. The phrase therefore
  asks (rises) and answers (falls) — the single most important device for
  making random notes feel like music.
- **Beat 7 is the cadence**: always a note, always the *next* chord's root
  (anticipation). Duration 2 beats, slightly softened velocity. A phrase that
  ends on a non-chord tone would feel unresolved; the cadence rule makes every
  phrase land.

**Rhythm.** Note durations are drawn from `{0.5: 15%, 1: 55%, 1.5: 10%,
2: 20%}` beats, truncated so they never overlap the next event. Rests are
drawn per beat at the §6 probability. The net effect is roughly one note per
beat at most, with frequent gaps — an ambient texture, not a melody line you
can hum.

## 8. Layer 4 — Bass

On every chord change (beats 0 and 4 of each phrase) the composer emits a
**bass event**: the chord root in the bass register, duration = the whole
chord (4 beats), low velocity. This is the harmonic floor that makes the
progression audible without adding melodic busyness.

## 9. Layer 5 — Modulation

Every **6–12 phrases** (≈ 23–46 s of thinking) the composer modulates: it
picks a *different* key from the §3 table and resets progression, motif and
last-note state. A long thinking session therefore travels through several
keys and modes — the ultimate guard against "boring and tired".

## 10. Motif development (the clever part)

Pure rule-based picking is coherent but can feel aimless. The Muse also
maintains a **motif**: a short sequence of 3–5 scale-degree steps (e.g.
`[1, 2, 1, -1]`), generated as a small random walk. When a motif is active,
note events consume it one step at a time, anchored to a scale degree near the
previous note. After the motif is exhausted the composer chooses:

- 50% — compose a **new** motif
- 30% — **develop** the old one: invert (negate all steps), retrograde
  (reverse), transpose (re-anchor a scale degree away), or fragment (keep
  only the first two steps)
- 20% — drop the motif and return to free rule-based picking

This is classical variation technique (state / inversion / retrograde /
transposition) applied to a 4-note fragment, and it is why the melody sounds
like it is *thinking in themes* rather than wandering.

## 11. Timbre and dynamics

Per phrase the composer also draws a **timbre**: low-pass cutoff
`400 + 900 × rng` Hz, detune width `2 + 5 × rng` cents, and a 25% chance the
lead voice is a triangle instead of a sine (a little more bite). The audio
engine renders each **melody** event as:

- a lead oscillator (sine or triangle) at the event frequency,
- a sine partner detuned by the phrase's detune width (the "warmth" of the
  old pad, kept),
- both through the phrase's low-pass, then a gain envelope:
  `0.0001 → peak` over 80 ms, then exponential decay to `0.0001` over
  `min(1.2 s, max(0.3 s, 0.9 × duration))`.

**Bass** events are simpler: a single sine (no detune partner, no low-pass)
straight to a gain with a 150 ms attack and the same release rule.

Peak gains (before the user's per-sound volume and intensity multipliers,
which are applied exactly as before): melody `0.09`, bass `0.05`. Velocity
follows a phrase arc `0.45 + 0.35 × sin(π × beat / 7)` — soft at the start,
full mid-phrase, soft at the cadence.

## 12. Randomness model

One `mulberry32` PRNG per composer instance, seeded from
`Math.random()` at `thinkPad()` time (or an explicit seed in tests). Every
musical decision — key, progression, motif, surprise, note weights, rhythm,
timbre, modulation — consumes the same stream, so a given seed reproduces an
entire "session" of music exactly. Different thinking sessions get different
seeds and therefore different music; within a session the music evolves
continuously and never repeats a phrase.

## 13. Failure behaviour

- `stopPad()` clears the phrase interval; already-scheduled events finish
  their envelopes (≤ ~1.4 s tail).
- If the AudioContext is suspended (autoplay policy), the interval keeps
  firing but **skips composition** until the context is running, so no notes
  stack at a frozen clock.
- The composer is pure: it cannot throw from the audio layer, and the audio
  layer cannot corrupt musical state.
