# Fixed values worth exposing

These numbers live in `app.js`, in the Web Audio graph Play uses. A new control has to be saved with the song snapshot.

## Expose

| Control | Now |
|---|---|
| Master level | 0.85 |
| Kick duck | music, delay, and reverb drop to 0.62, back by ~0.22 s |
| Reverb length | 3.2 s |
| Reverb darkness | lowpass at 2800 Hz in front of the tail |
| Kick pitch | 165 Hz falling to 46 Hz |
| Kick tick | 0.28 of the kick, highpass 1800 Hz |
| Hat brightness | closed highpass 8000 Hz, open 5200 Hz |
| Sub tone | lowpass 220 Hz |
| Stab detune | saws at −7, 0, +6 cents, plus 2 cents per chord note |
| Stab filter sweep | opens at 2.4× cutoff, settles near 0.55× |
| Chord hold | 16 bars before autopilot may pick a new chord |
| Breakdown length | always 4 bars |
| Plate delay send | 35% of the plate, plus a full send to the reverb |

Level, length, mute, cutoff, resonance, delay, reverb amount, drive, and width are already sliders.

## Leave fixed

Compressor (−10 dB, ratio 3.2), waveshaper curve, stereo shelf (+3.5 dB at 4200 Hz), delay pans (±0.75), drum bus 0.9, delay return 0.85, reverb return 0.9. These keep the existing sliders in a useful range.

Few-millisecond attacks. They stop notes clicking.

Chord notes. Those are the shapes on the grid.
