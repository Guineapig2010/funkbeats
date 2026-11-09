# AIMS — AI Music Studio

A browser-based music creation application: describe a song, get an **original, multi-part arrangement that actually plays**, edit every note in a full DAW, mix and master it, and export WAV / MP3 / stems / MIDI.

Everything musical runs in your browser with the Web Audio API. Claude is an *optional* composer and assistant reached through a small Node backend, so no API key is ever shipped to the browser. Without any key, the built-in algorithmic composer and an offline assistant still work.

> **Honesty notes:**
> - Every built-in instrument is **synthesized** (subtractive, FM, additive organ, Karplus–Strong string models, synthesized drum kits). Names like "Violins (synth)" describe the target character; they are not recordings. For realistic acoustic sound, import samples you own into a **Sampler** track.
> - **AIMS does not fake singing.** Vocal songs get a guide melody with lyric syllables on the notes, played by a guide synth that is not a voice. Real vocals come from recording, importing, or a connected vocal provider (see below).

---

## Quick start

Requirements: Node.js 20+ and a modern desktop browser (Chrome/Edge recommended; Firefox and Safari work with minor differences).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. This starts Vite (frontend) and the API server (port 8787) together. To enable Claude, see [AI integration](#ai-integration-claude).

Production build and server (one process serves the app and the API):

```bash
npm run build
```

```bash
npm start
```

Then open http://localhost:8787.

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server plus the API server with auto-reload |
| `npm run build` | Type-check (`tsc -b`) and build the frontend into `dist/` |
| `npm start` | Production server: serves `dist/` and `/api/*` on `PORT` (default 8787) |
| `npm test` | Unit and integration tests (Vitest). Audio is rendered for real in Node via `node-web-audio-api` |
| `npm run test:slow` | Renders full generated songs and checks loudness, clipping and per-section levels |
| `npm run test:e2e` | Playwright smoke test against a running server (`AIMS_URL`, default `http://localhost:8787`) |
| `npm run verify` | Type-check, test, then build |
| `npm run package` | Create `release/aims-studio-<version>.zip` (source only, no `node_modules`) |

Dev tools: `npx tsx scripts/calibrate-presets.ts` re-measures every preset's loudness and rewrites `src/model/presetTrim.ts`. `npx tsx scripts/calibrate-mix.ts "prompt"` prints per-track levels of a generated song.

---

## Using the app

- **Simple mode** (first launch): type a description, set a few controls, then press **Generate Music** and **Play**. Buttons like "Try another version", "More energy" and "More cinematic" change the song, and every change can be undone.
- **Studio mode** has five areas:
  - **Top bar:** transport (play/pause, stop, record, loop, metronome), position, BPM, time signature, key, undo/redo, save, export, master meter.
  - **Left:** browsers for instruments (audition, drag onto a track), samples and recordings, effects and presets, and projects (recent projects, templates, import/export).
  - **Centre:** the arrangement timeline, with sections, chords, markers, loop region and clips.
  - **Bottom tabs:** Piano Roll / Drum step sequencer, Mixer, Instrument & FX, Automation, Vocals & Lyrics, Master & Analysis.
  - **Right:** the AI Generator (prompt, controls, AI actions, region instructions) and the Assistant chat.
- **Selecting a region:** drag in empty timeline space, or click a section name in the ruler. AI actions and instructions then apply only to that region.

### Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| Enter | Stop and return |
| R | Record |
| L | Loop |
| M | Metronome |
| Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) | Undo / redo |
| Ctrl+S | Save |
| Ctrl+E | Export |
| Ctrl+C / Ctrl+V / Ctrl+D | Copy / paste / duplicate clips |
| Delete | Delete selected clips |
| V / B / E / S | Select / draw / erase / split tools (S splits the selected clips at the playhead) |
| Ctrl+wheel | Zoom |
| Esc | Clear selection |

In the piano roll: arrows nudge or transpose (Shift+↑/↓ moves an octave), Q quantizes, Ctrl+A/C/V/D select-all/copy/paste/duplicate, and Alt+drag duplicates notes.

With the Instrument tab open, the computer keys A–; play the on-screen keyboard (Z/X change octave).

---

## Architecture

```
src/
  model/      Versioned project schema (zod), factory/migrations, tempo & meter maps, clip ops, presets, effect defs
  theory/     Scales, modes, chord symbols, roman numerals, voice leading
  compose/    Prompt parser → planner (form, harmony, orchestration) → part generators → realizer; transforms for AI actions
  audio/      engine.ts (live façade), graph.ts (mixer graph), scheduler.ts (transport), compile.ts, render.ts (offline),
              instruments/ (synth engines, drum kits, sampler), effects/ (16 processors), worklets.ts (limiter, gate, recorder)
  ai/         Validated command language, project-context summarizer, Claude client, offline assistant
  midi/       Standard MIDI File reader/writer
  export/     WAV encoder/decoder, MP3 (lamejs, lazy-loaded), peak/RMS/LUFS analysis
  storage/    IndexedDB persistence for projects and audio assets
  state/      Zustand store (immutable project, undo/redo, gestures, autosave) and user actions
  ui/         React components: timeline, editors, panels
server/       Node HTTP server: Claude proxy, vocal-provider bridge, static hosting
tests/        Vitest suites (real audio rendering in Node)   e2e/  Playwright smoke test
```

The required engine components map onto these modules:

| Component | Where |
|---|---|
| Transport & scheduling | `audio/scheduler.ts`: a look-ahead scheduler running on a Worker timer. Event times always come from the audio clock (with anchor points for loops), so playback does not drift |
| Instrument generation | `audio/instruments/*` (subtractive, FM, organ, Karplus–Strong, sampler, drum kits) |
| Audio playback | `audio/graph.ts`: `playNote` / `playAudio` |
| Composition data | `model/schema.ts`, `compose/spec.ts` |
| AI commands | `ai/commands.ts`: a zod-validated discriminated union; nothing is ever `eval`'d |
| MIDI editing | `model/clipOps.ts`, `ui/editors/PianoRoll.tsx`, `ui/editors/DrumEditor.tsx`, `midi/midi.ts` |
| Audio effects | `audio/effects/effects.ts` |
| Mixing | `audio/graph.ts`: channel strips, sends, returns, routing, mute/solo, meters |
| Offline rendering | `audio/render.ts`: the same graph and scheduler on an `OfflineAudioContext`, chunked with `suspend()` |
| Project storage | `storage/db.ts` (IndexedDB) and `state/store.ts` (autosave) |

**Key decisions**

- **Raw Web Audio instead of Tone.js.** The same graph code drives live playback and `OfflineAudioContext` export, which is what guarantees "export = what you hear". It can also be tested in Node with `node-web-audio-api`.
- **Click-free envelopes without `cancelAndHoldAtTime`.** Release values are computed analytically, so releases never jump, even mid-attack.
- **Inlined AudioWorklets** (look-ahead brick-wall limiter, gate, sample-accurate recorder). They load identically in dev, prod and offline renders. If AudioWorklet is unavailable, native fallbacks are used.
- **Loudness-calibrated presets.** `presetTrim.ts` puts every preset at a common reference level. Composer role volumes then give a balanced mix with headroom before mastering.
- **Immutable project with snapshot undo.** Every edit, including every AI action, is one undo step. Drags are grouped into a single step as gestures.

### Project format (version 1)

`ProjectSchema` in `src/model/schema.ts` is the single source of truth. A project contains:

- tempo and tempo changes; time signature and signature changes; key
- tracks, each with: instrument (kind, parameters, drum pieces, sample zones), clips (MIDI notes with lyrics, or audio-clip data), effects, sends, output routing, automation lanes, group
- return buses and master chain; markers; sections (with energy and transposition); chord events; loop
- lyrics and vocal direction; generation settings; arrangement style; metronome

Loading always goes through `parseProject` (validation plus `migrateProject`). Exported project files are `.aims.json`. They contain notes and settings but **not audio**: recorded and imported audio stays in the browser's IndexedDB.

---

## AI integration (Claude)

1. Get an API key from the Anthropic Console.
2. Start the server with the key in its environment (never put it in frontend code or a `VITE_*` variable):

   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm run dev
   ```

   You can also copy `.env.example` to `.env` and export it with your process manager.
3. In the AI panel, choose **Composer → Claude**. The assistant chat switches to Claude automatically.

**How Claude is used**

- **Compose** (`POST /api/ai/compose`): Claude returns a `CompositionSpec` (`src/compose/spec.ts`) covering:
  - tempo, key, meter and form
  - chords for every bar
  - instrumentation chosen from the preset list
  - explicitly written melody (and vocal) **notes** for each section kind, plus lyrics

  The server validates the spec with zod, and gives Claude one repair round if validation fails. The browser validates it again. The local realizer then performs it: parts Claude did not write are generated from its plan.
- **Assistant** (`POST /api/ai/assist`): Claude receives a structured project summary (sections, chords, tracks, effects, selection, and the notes in the selection). It returns `{reply, commands}`. Commands are validated, then applied as pure project transforms. Invalid commands are rejected and shown in the chat. All of it is undoable.
- **Lyrics** (`POST /api/ai/lyrics`).

**Settings and behaviour**

- Defaults: model `claude-opus-5-5` (change with `AIMS_MODEL`), effort `medium` (change with `AIMS_EFFORT`).
- Requests are streamed, so long outputs don't hit HTTP timeouts.
- The server-side refusal fallback (`fallbacks: "default"`) is enabled. To turn it off, remove the `betas`/`fallbacks` fields in `server/index.ts`.
- Rate-limit, authentication and refusal errors come back as readable messages.

**Not tested here:** the Claude endpoints were not exercised against the live API in this build environment (no key was available). Everything around the call — JSON extraction, spec and command validation, applying commands, key isolation — is unit-tested; the live round-trip is not.

---

## Vocal providers

There is no built-in singing synthesizer. Configure one of these on the server:

| `VOCAL_PROVIDER` | What you get | Extra env |
|---|---|---|
| `fishaudio` | **Speech** (text-to-speech) for spoken-word sections. It is not singing, and the UI labels it as speech | `FISH_AUDIO_API_KEY`; optional `FISH_AUDIO_VOICE_ID`, `FISH_AUDIO_MODEL` |
| `http` | Your own singing-synthesis service | `VOCAL_PROVIDER_URL`; optional `VOCAL_PROVIDER_TOKEN`, `VOCAL_PROVIDER_NAME` |

**Fish Audio:** the request shape was verified against `api.fish.audio/v1/tts`. An account without API credit gets HTTP 402. The API's error message suggests setting `FISH_AUDIO_MODEL` to a free model it names.

**HTTP provider contract.** AIMS sends `POST <VOCAL_PROVIDER_URL>` with this JSON body:

```json
{
  "text": "...",
  "notes": [{"pitch": 64, "start": 0, "duration": 1, "lyric": "hel"}],
  "bpm": 120,
  "voice": "female",
  "delivery": "soft"
}
```

- `notes` have absolute positions in beats.
- The service must answer with audio (`audio/wav` or `audio/mpeg`) aligned to beat 0 of the first vocal note.

The result is imported as a normal audio clip.

---

## Deployment

- **Any Node host** (VM, Fly.io, Render, Railway…):

  ```bash
  npm ci
  ```

  ```bash
  npm run build
  ```

  ```bash
  PORT=8080 ANTHROPIC_API_KEY=... npm start
  ```

- **Docker:** see `Dockerfile`.

  ```bash
  docker build -t aims .
  ```

  ```bash
  docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... aims
  ```

- **Static-only hosting** (no AI backend): serve `dist/` from any static host. The local composer, editing, recording and export all work. Claude and vocal providers will report "not configured".
- **Serve over HTTPS** (or from localhost). Browsers only allow microphone access and persistent storage in secure contexts.

---

## Feature status

✅ implemented and verified · ◐ partial · ✗ not implemented

**Verification**

- **Unit tests** (`npm test`, 65 tests):
  - composition for 13 prompt styles (valid schema, in-key melodies, requested durations)
  - real offline audio renders: every preset makes sound; mute, volume, effects and limiter change the output
  - timeline editing ops, serialization round-trip, MIDI and WAV round-trips
  - command validation, region-limited regeneration, the local assistant, and server key-leak checks
- **Browser smoke test** (`npm run test:e2e`) in headless Chromium:
  - generation and audible playback
  - offline render, plus WAV / MP3 / MIDI downloads that were decoded and checked
  - an AI action followed by undo, and a local-assistant edit
  - every panel renders
  - fake-microphone recording
  - persistence across a page reload, with no page errors

| Area | Status | Notes |
|---|---|---|
| Local AI composer (prompt → full arrangement) | ✅ | 18 genre styles, 14 moods, durations, key, tempo, structure, instrumentation, complexity, energy, creativity, seeds |
| Claude composition and assistant | ◐ | Implemented with server validation and repair; not run against the live API here (no key) |
| AI action buttons (regenerate, extend, remix, genre, add/remove instruments, improve melody/chords/rhythm, variation, cinematic, energy, soften, new intro/ending, harmonies, humanize) | ✅ | Region-aware and undoable |
| Region instructions ("make these 8 bars more dramatic…") | ✅ | Claude handles free text; the offline assistant covers common phrasings |
| Timeline (multitrack, zoom/scroll, move, copy, duplicate, trim, split, loop clips, snap, grid incl. triplets, markers, sections, loop region, undo/redo) | ✅ | |
| Tempo changes / time-signature changes | ◐ | Tempo: step changes only, no ramps; rendering and grid follow them. Signature changes affect the grid and bar numbering; the composer writes in one meter |
| Track grouping / colours | ◐ | Groups organise and colour tracks; there are no group buses or VCAs |
| Instruments: synth keys, EP, organ, basses, leads, pads, plucks, bells, FX, string/brass/woodwind approximations, drum kits | ✅ | All synthesized; ADSR, filter and filter-envelope, vibrato, LFO, unison, glide, velocity, pan, polyphony with voice stealing |
| Sampled instruments | ◐ | Multi-zone sampler, auto-mapping from file names, per-drum-piece sample replacement. **No sample libraries are bundled** |
| Piano roll | ✅ | Draw, erase, move, resize, box-select, copy/paste, velocity lane, quantize with strength, transpose, octaves, chords tool, scale highlight and snap, chord-tone highlight, swing, humanize, legato, lyric display, virtual keyboard |
| Drum sequencer | ✅ | Steps at 1/8–1/32 and triplets, velocity, accents and ghosts, rolls, pattern length, swing, fills, variations, humanize, sample replacement |
| Mixer | ✅ | Faders, pan, mute/solo, peak/RMS meters, insert chains, reverb/delay sends, output routing to buses, master |
| Effects | ✅ | EQ, compressor (parallel mix), look-ahead limiter, convolution reverb, tempo-synced ping-pong delay, chorus, flanger, phaser, distortion (4 curves), saturation, filter/auto-filter, stereo width (M/S, mono-bass), sidechain-style ducking, noise gate, bitcrusher, utility gain |
| Automation | ✅ | Volume, pan, sends, any effect parameter, per-note synth cutoff/resonance; works live and in export |
| Mastering presets and analysis | ✅ | Cinematic, pop, rock, electronic, acoustic, classical, lo-fi, podcast, clean; spectrum, spectrogram, stereo correlation, limiter gain reduction, LUFS estimate on export |
| Recording | ✅ | Count-in, metronome, arming, input monitoring, sample-accurate AudioWorklet capture with latency compensation (estimate) |
| Audio import, clips, fades, gain, rate, reverse, waveform | ✅ | Formats depend on the browser decoder; failures are reported |
| Pitch correction | ◐ | Pitch analysis only (detected notes and cents deviation). No automatic correction or time-preserving re-tuning |
| Lyrics, syllable alignment, vocal guide, harmonies | ✅ | Local lyric writer is template-based; Claude writes real lyrics |
| AI singing | ◐ | Only through an external provider you configure; none is bundled |
| Export: WAV 16/24/32f at 44.1/48 kHz, MP3 128–320 kbps, stems, MIDI, project file, normalize, range | ✅ | |
| Projects: autosave, recent, open, rename, duplicate, templates, import/export | ✅ | Storage-quota errors are reported |
| Mobile and tablet | ◐ | Layout adapts, but desktop is the primary target |

### Limitations

- Sound quality is bounded by synthesis. Orchestral and acoustic presets are convincing *approximations*; real samples or a dedicated audio-generation provider will sound more realistic.
- Very large projects (dozens of dense tracks) can exceed what a browser thread handles in real time. The app shows a warning; offline export is unaffected by real-time CPU limits.
- Audio clips are not time-stretched when the tempo changes.

---

## Licences and assets

- AIMS source: yours to license as you choose (no licence file is included yet).
- No third-party audio samples are included. All sounds are generated at runtime.
- Dependencies:
  - React, Zustand, Immer, zod: MIT; idb: ISC
  - `@anthropic-ai/sdk`: Apache-2.0
  - `@breezystack/lamejs` (MP3 encoder): LGPL-3.0, loaded as a separate lazy chunk
  - `node-web-audio-api` (dev only, tests): BSD-3-Clause
