# DM99 v3 — Local AI Groovebox

DM99 is a free, installable electronic-music machine that runs in the browser. It combines a 26-track groovebox, 32-step expressive sequencer, procedural sound library, local composition assistant, sampler, mixer, project library, MIDI tools, and real WAV mixdown.

The performance path is intentionally local: no account, database, paid model, API key, sample CDN, or hosted AI call is required. Once the app shell has been opened and cached, it can make music offline.

## What is included

- **26 guaranteed voices:** drums, cymbals, percussion, basses, leads, plucks, pads, and synthesis voices.
- **124 built-in sounds:** 84 procedural sample-style presets plus 40 native synth presets.
- **Eight kits:** Techno, Deep House, Electro, Trance, DnB, Industrial, Acid, and Ambient.
- **Expressive 32-step sequencing:** velocity, probability, ratchets, timing nudge, accent, pitch, scale, and slide.
- **Eight pattern slots:** A–H variations live inside every project.
- **Pattern Lab:** seeded genre composition, three instant candidates, lane locks, natural-language control hints, and editable transformations.
- **26-channel mixer:** per-lane sound selection, volume, pan, mute, and solo, plus master filtering, three-band EQ, drive/compression, delay, and space.
- **Local project library:** IndexedDB storage, autosave, named projects, browsable/restorable revision history, undo/redo, and migration from the older `dm99-pattern` save.
- **Sampler:** import or record audio, browse the on-device sample library, inspect waveforms, crop, normalize, reverse, tune, loop/gate, assign choke groups, or slice across four lanes.
- **Import/export:** versioned project JSON, Standard MIDI Files, shareable compressed pattern links, and non-silent stereo WAV mixdowns.
- **Performance input:** computer-keyboard pads and optional Web MIDI capture.
- **Installable PWA:** responsive desktop/mobile UI and an offline application shell.

## What “AI” means here

DM99 v3 uses **local symbolic composition intelligence**, not an LLM and not text-to-audio generation. Pattern Lab combines:

- curated genre foundations;
- deterministic seeded variation;
- energy, complexity, syncopation, and humanization controls;
- lightweight phrase parsing such as “dark techno, busy hats, less kick”;
- tonal accompaniment derived from the drum structure;
- lane locks and musical transformations.

Every result is immediate, reproducible from its seed, and remains fully editable. This avoids model downloads, network round trips, server cold starts, usage quotas, unpredictable model output, and provider costs.

The optional `/api/generate-pattern` function uses the same bounded rule engine for external consumers. The browser’s core Pattern Lab does not wait for it.

## Sound system

All built-in sound comes from native Web Audio synthesis and deterministic DSP. DM99 does not fetch SampleSwap, Freesound, Tone.js, Magenta, Google Fonts, or any other runtime CDN.

| Family | Tracks |
| --- | --- |
| Drums | Kick, Snare, Clap, Tom, Rim, Cow |
| Cymbals | HHC, HHO, Crash, Ride |
| Percussion | Perc1–Perc6, Shak, Tamb |
| Tonal | Bass, Acid, Synth |
| Synth | Sub, 808, FM, Pluck, AM |

Every track has a valid procedural preset in every kit. User-imported audio is an optional override; removing it leaves the built-in voice available.

## Quick start

Requirements: Node.js 22.x and a current browser.

```bash
npm install
npm test
npm run dev
```

Open `http://127.0.0.1:3000`, tap **Enable audio**, and either tap steps or create three ideas in Pattern Lab.

Useful commands:

```bash
npm test       # Run all state, generator, audio, storage and export tests
npm run build  # Syntax-check and prepare public/ for Vercel
npm run dev    # Start the zero-dependency local UI/API server
```

No environment variables are required. `.env.local.example` intentionally contains no token placeholder.

## Playing DM99

1. Select a kit and open the 26-track mixer to choose a lane and sound.
2. Tap the grid to place events. Mobile shows steps 1–16 and 17–32 as two large-pad pages.
3. Select a step to edit velocity, chance, ratchets, nudge, accent, pitch, scale, or slide.
4. Describe a groove or adjust Pattern Lab, then create three candidates and apply one.
5. Lock any lane you want to preserve before generating or evolving again.
6. Use pattern slots A–H to build alternate sections.
7. Save locally, export MIDI/JSON/WAV, or copy a pattern-only link.

Keyboard performance mapping:

| Keys | Tracks |
| --- | --- |
| `A S D F G H J K L ;` | Kick, Snare, Clap, HHC, HHO, Tom, Perc1, Perc2, Crash, Ride |
| `Q W E R T Y` | Bass, Acid, Sub, FM, Pluck, AM |
| `Space` | Play/stop |
| `1`–`8` | Pattern A–H |
| Arrow keys | Move through the visible step page |

## Projects and privacy

Projects and revisions are stored in IndexedDB when available, with safe localStorage or in-memory fallbacks. User samples are stored as browser-local Blobs. No project, recording, MIDI performance, or sample is uploaded.

- JSON contains the complete editable v3 state.
- MIDI is SMF type 1 and maps drums to General MIDI notes.
- WAV is rendered locally through `OfflineAudioContext` with the current voices, mixer settings, probability seed, and effect tail.
- Pattern links use native gzip when available; the UI removes project names and sample metadata, and embedded Blob data is rejected.
- Local storage is device/browser specific; export JSON for a portable backup.

## Pattern API

`POST /api/generate-pattern` is a stateless, zero-dependency Vercel Node function. It is useful for integrations but is not in the browser playback or generation critical path.

```json
{
  "genre": "dnb",
  "bpm": 174,
  "energy": 0.82,
  "length": 32,
  "seed": "warehouse-7",
  "variation": "b",
  "complexity": 0.7,
  "syncopation": 0.75,
  "humanize": 0.18
}
```

Accepted genres are `techno`, `house`, `trance`, `dnb`, `electro`, `industrial`, `acid`, and `ambient`. Length is 8–64 steps, BPM is 40–240, variation is `a`, `b`, or `c`, and all four intensity controls are bounded from 0 to 1. The request body is capped at 4 KB.

Successful responses contain 11 equal-length boolean lanes: Kick, Snare, HHC, HHO, Clap, Tom, Perc1, Perc2, Perc3, Crash, and Ride. Identical normalized inputs produce identical patterns.

```bash
curl -X POST http://127.0.0.1:3000/api/generate-pattern \
  -H "Content-Type: application/json" \
  -d '{"genre":"dnb","bpm":174,"energy":0.82,"length":32,"seed":"warehouse-7"}'
```

Errors are JSON with a stable `code` and sanitized `error` message. Unsupported methods return `405` with `Allow: POST`; invalid JSON/fields return `400`, oversized input returns `413`, and the wrong media type returns `415`.

## Architecture

| Path | Responsibility |
| --- | --- |
| `index.html`, `styles.css`, `script.js` | Accessible groovebox UI and browser integration |
| `src/instruments.js` | 26-track registry, 124 presets and eight kits |
| `src/audio-dsp.js`, `src/audio-engine.js` | Native live/offline Web Audio engines |
| `src/project-state.js` | Canonical v3 state and legacy normalization |
| `src/pattern-engine.js` | Seeded generation and transformations |
| `src/project-store.js`, `src/sampler-store.js` | IndexedDB persistence and safe fallbacks |
| `src/exporters.js`, `src/binary-utils.js` | JSON, MIDI, WAV and share-link codecs |
| `api/generate-pattern.js` | Optional stateless JSON pattern API |
| `service-worker.js`, `manifest.webmanifest` | Installation and offline shell |

## Verification

Automated coverage checks generator determinism/bounds, schema migration, A–H state, expressive steps, the full preset registry, live and offline audio-graph scheduling, project revisions/autosave, sample quotas, and JSON/MIDI/WAV/share codecs.

Before publishing a release, also verify in a real browser:

- audio readiness reports 26/26 and every mixer lane auditions;
- transport advances one audible playhead and stop releases voices;
- all eight genres create three editable candidates offline;
- saved generator/mixer state survives reload;
- JSON, MIDI, and WAV downloads are valid and WAV contains audio signal;
- imported audio can be edited, stored, restored, and auditioned;
- 390×844 and 320×568 layouts have no horizontal overflow;
- dialogs scroll, close with Escape, and return focus;
- a service-worker-controlled reload succeeds with networking disabled;
- the console is free of runtime warnings and errors.

## Deploying to Vercel

Run `npm run build`, then deploy the repository with Vercel’s Git integration or CLI. `package.json` declares Node 22.x; `vercel.json` selects `public/`, bounds the optional function, and applies a same-origin CSP plus privacy/security headers.

No database, marketplace integration, AI Gateway, storage product, or paid provider needs to be provisioned. This repository has not been deployed merely by running the local build.

## Current boundaries

- The sequencer is intentionally fixed at 32 editable steps per pattern.
- Web MIDI, microphone recording, PWA installation, and offline audio rendering depend on browser support and permission.
- IndexedDB quota and persistence policy are controlled by the browser/device.
- Deleting an on-device sample removes the Blob; any older project revision that referenced it falls back to that lane's built-in local voice.
- A newly cached PWA release activates after existing DM99 tabs close, preventing old and new audio modules from mixing in one session.
- Pattern links exclude user samples and may be too long for some messaging platforms; JSON is the durable exchange format.
- There is no account, cloud sync, collaborative room, stem separation, or hosted generative-audio service.
- No third-party sample pack is bundled. Import only audio you have permission to use.
- This repository currently has no explicit `LICENSE` file; do not infer a code license from the product description.

## Credits

- Original DM99 concept: J. Gazca
- Audio platform: the browser-native Web Audio API
- Built-in voices and presets: procedurally generated by DM99
