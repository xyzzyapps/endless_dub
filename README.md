# Endless Dub

[![Built by Grok](https://img.shields.io/badge/Built%20by-Grok-3ec2ff?style=flat-square)](https://grok.x.ai)

![First frame](preview.png)

Generative dub techno in the browser. Open `index.html`, press Play.

Slow tempo, a dry kick, a sine sub, open minor and sus chords, and a filtered ping-pong delay. Autopilot drifts the filter, nudges the pattern, changes chord every few dozen bars, and occasionally drops the kick for four bars.

The lean-back session — step grids, autopilot, one-button regenerate — follows [Vitling’s Endless Acid Banger](https://www.vitling.xyz/toys/acid-banger/) and [Zykure’s spicy version](https://zykure.github.io/acid-banger/) (CC BY 4.0). The synthesis and patterns here are a separate piece written for dub.

Live: https://xyzzyapps.github.io/endless_dub/

A phone plays the same Web Audio graph as a computer. The phone asks for a larger playback buffer, reuses a small set of kick, hat, snare, bass, and chord voices, and draws the plate and waveform about four times a second while it is playing. A computer still builds a fresh voice on every hit. The Csound engine is not used.

Support on https://xyzzy.gumroad.com/

## Assumptions

The starting pattern, the step weights, and the knob positions are the visible assumptions. The generator also has rules that stay in effect after those are edited.

* Each step weight is the chance, from 0 to 100, that the step is on the next time the pattern is written. Zero is never chosen. 100 is always chosen. The opening weights follow the opening loop: a note in that loop starts at 92, and every other step starts at 0. New pattern rolls every step from those weights, so it stays close to the same loop. Autopilot checks at the end of every 16 bars. The pattern weight is the chance that check writes a whole new pattern, and that pattern is rolled from the step weights.
* The key starts on D. The stab cycles through the same three open shapes as before, one per bar, and a chord change only transposes that cycle. The sub and the plate stay on the key. The chord menu lists the minor-key neighbours of the root. Harmonise keeps New chord and autopilot inside that list. With Harmonise off, a new chord can start on any pitch.
* Tempo stays in beats per minute and starts at 122. Cutoff is in hertz and starts at 680. Feedback is the percent sent back around the delay, from 20 to 88, and starts at 70. Note lengths are in milliseconds. The other sliders are 0 to 100 across their own range. The delay starts as a dotted eighth. The plate starts silent. Cutoff glide, Muteouts, and Swing start on. Delay send, Width, and Resonance start off. Feedback cannot drift above 0.75.
* Waveforms, plate mode ratios, kick ducking, and the stereo width circuit are fixed. No control rewrites them.

Cutoff glides continuously. Weight 20 keeps it near ±20 Hz. Weight 100 can move about ±800 Hz and picks a new spot about every third of a second.

The other autopilot knobs glide the same way. The weight is how far they may wander and how soon they pick a new spot. At 100 the reach is:

| Weight | Reach |
|---|---|
| Feedback | ±14%, and it will not go above 75% |
| Damp | ±1400 Hz |
| Reverb | ±28% |
| Decay | ±220 ms |
| Delay send | ±28% |
| Width | ±28% |
| Resonance | ±7 |
| Swing | ±0.16 |

Pattern, chord, and muteouts are checked at the end of every 16 bars. The pattern weight is the chance of a new pattern then, and the step weights choose its notes. A higher chord or muteout weight makes that 16-bar change more likely. The effect knobs move on every step, the same way cutoff does.

A saved song would store the pattern, every step weight, and the knob values. **New pattern** would still follow the rules above.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). Noncommercial use only.

Required Notice: Copyright 2026 Xyzzy Apps (xyzzyapps@gmail.com)
