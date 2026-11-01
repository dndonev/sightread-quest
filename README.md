# SightRead Quest

A mobile-first PWA that rebuilds **fluent sight-reading** for musicians who know theory but have lost reading speed. Guitar-first (with correct written-vs-sounding octaves), piano supported.

Three stages, ten levels each, with adaptive spaced repetition, accuracy-first scoring and offline play:

| Stage | What you train | Modes |
|---|---|---|
| **Note Hunter** | Instant note recognition: lines/spaces, ledger lines, accidentals, key signatures with accidental carry-over, bass and mixed clefs | Practice · Sprint (60 s) · Survival (3 lives) · Weak notes · Speed ladder |
| **Chord Decoder** | Reading harmony: triads → 13ths, altered dominants, inversions, open/drop-2 voicings, rootless voicings with context | Name · Root/Quality/Inversion · Missing tone · Intervals · Staff → fretboard · Ear → staff · Progressions (ii–V–I, secondary dominants, ♯i°7 …) |
| **Sight-Reading Arena** | Real-time reading of generated, musically coherent phrases and public-domain tunes | A Read & identify · B Rhythm (tap & hold) · C Virtual fretboard/keyboard · D Microphone (monophonic YIN) · E Read ahead (current beat masked) |

Plus Daily Training (notes → chords → reading, customisable minutes), Practice Lab (custom ranges/levels/bar counts), statistics (trends, note heat-map, rhythm cells, calendar, personal bests, achievements), onboarding and settings.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit tests (theory, generators, evaluation, scoring, pitch detection)
npm run build        # type-check + production build with service worker → dist/
npm run preview      # serve dist/ (test install/offline here)
npm run e2e          # Playwright (builds + previews automatically)
# If Playwright's bundled browser isn't installed, point it at Chrome:
CHROME_PATH=/usr/bin/google-chrome npm run e2e
```

Requires Node 20+.

## Architecture

```
src/
  music-theory/       pure, fully tested
    pitch.ts          spelled pitches (letter + accidental + octave), MIDI, solfège
    interval.ts       interval spelling by letter steps → correct enharmonics; interval names
    keys.ts           key signatures, scales, MeasureAccidentalState (per-octave carry-over)
    chords.ts         interval-formula chords, inversions, slash symbols, identification, ambiguity checks
    guitar.ts         standard tuning, written↔sounding (+1 octave), fret positions, chord fingering search
    rhythm.ts         ticks (PPQ 48), meters, compound beat grouping, tempo↔ticks
    random.ts         seeded PRNG (mulberry32) for reproducible tests
  notation/
    staff.ts          clef positions, ledger lines, plain-language position descriptions
    render.ts         VexFlow (Bravura font embedded → works offline): single notes, chords, grand staff,
                      progressions, full scores with beams/ties/tab and layout data for the playhead
  game-engine/
    noteHunter.ts     levels, question generation, key-signature questions, grading, explanations
    chordDecoder.ts   levels, voicings (close/drop-2/rootless, guitar-playable), distractors, modes, progressions
    sightReading.ts   phrase generator (rhythm cells, phrase structure, gap-fill melody, cadences,
                      chromatic approach tones, ties, double-stops), public-domain tunes
    evaluation.ts     rhythm / performance / identify evaluation in ticks, feedback text
    scoring.ts        explicit scoring formula, XP & player levels
    progress.ts       streaks and achievements
  adaptive-learning/
    mastery.ts        per-item stats, Leitner scheduling, mastery estimate, weighted picking, level gates
  audio/              Tone.js engine (synth, metronome, SFX) + audio-clock ScoreClock with look-ahead scheduling
  pitch-detection/    YIN estimator, onset tracker, microphone wrapper + noise calibration
  persistence/        Dexie (IndexedDB) repository and typed settings/profile/session models
  state/store.ts      Zustand store, hash routing, write-through persistence
  components/ stages/ screens/   UI
  tests/              Vitest suites
e2e/                  Playwright suites
```

### Key decisions

- **Spelling first.** Every pitch is spelled. Transposition moves by letter steps and then fixes the accidental, so C + ♯9 is D♯ (never E♭) and B dim7 contains A♭. Chord answers are always derived from the *actual* lowest note on the staff.
- **Defensible answers only.** Distractors are rejected if the shown notes also support them (e.g. C6 vs Am7/C, Csus2 vs Gsus4/C) or if they are enharmonically identical over the same bass. Rootless voicings always come with harmonic context (“the bass plays D”).
- **Guitar octaves.** All fretboard maths uses sounding pitch; the staff shows written pitch with an 8vb treble clef. A setting chooses whether octave numbers are labelled written or sounding. Audio always plays sounding pitch. Wrong-octave performance mistakes are reported separately.
- **One clock.** Playhead, metronome, taps, virtual-instrument presses and microphone onsets all use `AudioContext.currentTime`, converted to ticks at the moment of input, so pausing or tempo changes never distort grading. Hit tolerance is ±22% of a beat, clamped to 60–180 ms.
- **Scoring (accuracy first).** Correct answer = (100 + speed bonus) × streak multiplier; speed bonus (0–50, linear between 3.0 s and 0.8 s) only applies while rolling accuracy ≥ 80%; streak multiplier 1 + 0.05 × min(streak, 10). Session score = Σpoints × accuracy². Random tapping keeps ~2% of the points. Tested in `src/tests/game-engine.test.ts`.
- **Advancement by mastery, not XP.** A level unlocks the next one after ≥ 20 recent answers (or phrases) at the mastery threshold (default 90%), and for Note Hunter a median time under your fluency target (3 s / 1.5 s / 0.8 s by experience). “Unlock all levels” is available in Settings.
- **Spaced repetition.** Items (note-at-position, chord quality/inversion, interval, rhythm cell, progression) move through Leitner boxes (2 min → 21 days). Weight = 1 + 4·(1 − mastery) + overdue bonus, so weak items come up often and mastered ones still return.

### Known limits

- Microphone mode is **monophonic** (YIN). Chords, strong attack harmonics, and noisy rooms reduce accuracy; calibrate noise and latency in Settings. Polyphonic chord detection is not implemented.
- “Multiple voices” in Sight-Reading is represented by double-stops (3rds/6ths); independent two-voice writing is not yet generated.
- Tuplets are supported by the tick model (PPQ 48 divides into triplets) but not yet generated in exercises.
- iOS only allows audio after a tap; every session starts from a button for that reason. Interrupted audio (calls, Siri) pauses the phrase and resumes on the next tap.

## PWA / offline

`vite-plugin-pwa` precaches the app shell, JS (including the embedded Bravura music font) and icons. After the first load, all three stages work offline; progress lives in IndexedDB on the device. Install via “Add to Home Screen” (iOS Safari) or the install prompt (Android Chrome).

## Packaging with Capacitor (later)

The app is a static SPA with relative asset paths and hash routing, so it drops into Capacitor unchanged:

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "SightRead Quest" com.example.sightreadquest --web-dir dist
npm run build
npx cap add ios && npx cap add android
npx cap sync
npx cap open ios   # or: npx cap open android
```

Notes:
- Add `NSMicrophoneUsageDescription` to `ios/App/App/Info.plist` and `RECORD_AUDIO` to the Android manifest for Real Instrument mode.
- The service worker is not needed inside Capacitor; it is harmless, but you can skip registration by checking `Capacitor.isNativePlatform()` in `src/main.tsx`.
- For lower audio latency on Android, consider a native audio plugin later; the Web Audio path works as is.
