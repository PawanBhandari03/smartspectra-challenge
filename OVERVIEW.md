# Gut Check — Project Overview

> **Your body votes on your decisions.**
> A desktop app that watches how your body reacts (through your laptop webcam) while you imagine living each of your options, and shows you which one your body relaxed into and which one made it tense.

This file explains the whole project: what it is, how it works, and what each part of the code does. It is updated as the project grows.

---

## 1. The challenge

- **Contest:** Presage SmartSpectra SDK Challenge on DEV.to (tag `#presagechallenge`)
- **Prizes:** $3,000 across 10 winners
- **Deadline:** November 22, 2026
- **Submission:** a DEV.to post + this GitHub repo + a demo video

## 2. The idea

When people can't decide ("Should I stay in my city or move for the new job?"), they often say "my gut says...". Neuroscience has a name for this: the **somatic marker hypothesis** (Antonio Damasio). The body reacts to choices (heart, breathing, face) before the conscious mind can explain why.

**Gut Check makes those reactions visible.** It is not a decision machine; it is a **mirror**. It shows you how your body reacted, and asks you to reflect on why.

## 3. What the user does

1. **Enter options:** type 2–3 choices (e.g. "Stay in my city", "Move to Bangalore").
2. **Consent:** a clear privacy screen. No video is saved; this is a wellness tool, not medical advice.
3. **Camera check:** face inside a guide oval, good lighting. No credits are spent here.
4. **Baseline (~60 s):** sit calmly and breathe normally. This is "normal you".
5. **Imagine each option (~75 s each):** guided prompts on screen ("It's six months from now... picture your Monday morning..."). Options appear in random order.
6. **Automatic reset (~20 s)** between options so the body settles.
7. **Body Vote:** results per option compared to baseline, a verdict ("Your body leaned toward A" / "Too close to call" / "Not enough clear signal"), a timeline chart and reflection questions.
8. **Saved locally:** numbers only (never video), so you can compare sessions later.

## 4. How a webcam measures the body

We do **not** calculate vitals ourselves. The **Presage SmartSpectra SDK** does that and hands us numbers several times a second.

| Signal | How the SDK gets it from video | Speed |
|---|---|---|
| **Pulse** | Each heartbeat changes skin colour very slightly (invisible to eyes, visible to a camera). This is called rPPG. | 12 s average |
| **Breathing rate** | Tiny up/down movements of chest and shoulders | 30 s average |
| **HRV** (heart-rate variability) | Time gaps between heartbeats. Calm = more variation; stress = more even beats | 60 s window |
| **Facial expressions** | 478 face points + an AI model → happiness, fear, sadness, surprise, etc. | Instant |
| **Blinks** | Eye landmarks | Instant |

Presage's technology was **FDA-cleared in June 2026** for pulse and breathing rate from video. The developer SDK we use is labelled for **general wellness**, so Gut Check is never presented as a medical device.

## 5. How the "Body Vote" works

For each option, every signal is compared with the baseline:

- Pulse **up** → more tense / aroused
- Breathing **faster** → more tense
- HRV **down** → more stressed
- More **negative** expressions (fear, sadness, disgust) → more tense; more **happiness** → calmer
- Blink rate **change** → stress / focus shift

Each change becomes a small **calm ↔ tense** score, and the scores are combined per option.

Honesty rules:
1. Only readings the SDK marks as **reliable** (confidence / "stable") count.
2. If options are close, the verdict is **"Too close to call"**. We never invent a winner.
3. "Tense" doesn't mean "bad choice": excitement also raises the pulse. The result asks the user to reflect.

## 6. The technology

| Part | What it is | Why |
|---|---|---|
| **Electron** | Bundles a private Chrome window + Node.js into one desktop app (`.exe`) | Presage has no browser SDK; Electron can run the Node SDK |
| **Node.js** (main process) | The "engine" | Runs the SDK, talks to Presage, saves sessions |
| **HTML / CSS / JavaScript** (renderer) | The screens you see | Easy to build and style |
| **Preload bridge** | A safe connection between engine and screens | Security: screens can't touch the system directly |
| **@smartspectra/node-sdk** | Presage's SDK | Webcam → vitals |
| **Chart.js** | Free charting library | Timeline and result charts |
| **dotenv** | Reads the API key from the `.env` file | Keeps the key out of the code |
| **esbuild** | A fast "bundler": packs our screen code + the SDK's screen-side code into one file (`dist/renderer.js`) | The SDK's screen code uses Node-style `require`, which a browser window can't run directly |

### How the live measurement actually flows

1. **Camera check (free):** the screen opens the webcam with the browser camera API (`getUserMedia`) to show a preview and measure the real frames per second. No credits are spent.
2. **On "Start":** the preview releases the camera, and the **SDK in the main process opens the camera itself** (`useCamera`) at 1280×720 / 30 fps.
3. Results come back from the SDK as small binary packets, are sent to the screen over the preload bridge, and are decoded with `@smartspectra/node-sdk/messages` into numbers (pulse, breathing, HRV, expressions, blinks).
4. Every event is also written to a **recording** (`recordings/session-*.jsonl`) so it can be replayed later for free.

**Why the camera runs in the main process:** the first live test (Nov 11) used the SDK's other Electron mode, where the screen copies every full-HD frame (~3.6 MB) to the engine. On this laptop only 10 frames/second got through; the SDK needs 25+, so it stopped itself (`kSustainedLowFrameRate`). Capturing natively in the engine removes that copying entirely.

**Lighting matters for frame rate:** in dim light a webcam lengthens its exposure, which lowers frames per second (20 fps in the first test). Light on the face from the front fixes it. The Signal Lab also has a free "manual exposure" experiment to force a faster camera.

### How to run it

```
npm start
```
This bundles the code (`scripts/build.js`) and opens the app (`scripts/start.js`).

```
   Webcam
     │
     ▼
┌──────────────── Electron app ────────────────┐
│  MAIN (Node.js)  ← SDK lives here             │
│   camera → SDK → pulse, breathing, HRV, face  │
│          │                                    │
│      preload bridge                           │
│          ▼                                    │
│  RENDERER (HTML/CSS/JS)                       │
│   screens, prompts, charts, Body Vote         │
└───────────────────────────────────────────────┘
```

## 7. Credits: our biggest constraint

The free Presage tier gives **100 credits; 1 credit = 30 seconds of live measurement**, about **50 minutes total**. They renew on Dec 11, 2026, **after** the deadline, so that's all we have.

Strategy: **record once, replay many times.**
- **Live mode:** real webcam + SDK. Spends credits.
- **Replay mode:** plays a saved session file as if it were live. **Zero credits.** Most of the app is built and tested this way.
- Measurement stops the instant a session ends.

| Use | Budget |
|---|---|
| First test + recording sample sessions | ~10 min |
| Occasional live checks while building | ~10 min |
| Final end-to-end tests | ~10 min |
| Demo video takes | ~15 min |
| Safety buffer | ~5 min |

## 8. Project structure

```
smartspectra-challenge/
├── OVERVIEW.md        ← this file
├── ROADMAP.md         ← step-by-step plan + progress
├── README.md          ← (later) public setup guide for judges
├── package.json       ← project info + dependencies + start command
├── .env               ← YOUR API key (never uploaded to GitHub)
├── .env.example       ← template showing what goes in .env
├── .gitignore         ← files git must never upload
├── scripts/
│   ├── build.js       ← bundles renderer + preload into dist/
│   └── start.js       ← launches Electron
├── src/
│   ├── main/main.js   ← Electron main process: window, the SDK + camera, API key, saving recordings
│   ├── preload/       ← secure bridge: window.gutCheck (SDK controls, events, recordings)
│   ├── renderer/      ← screens: index.html, styles.css, app.js
│   └── core/
│       ├── sources.js ← LiveSource (real SDK) and ReplaySource (saved file): same events
│       └── vitals.js  ← decodes SDK packets → pulse, breathing, HRV, expression, blinks
├── dist/              ← generated bundles (not committed)
└── recordings/        ← saved sessions for replay mode (not committed: personal data)
```

## 9. Privacy

- No video is ever saved or uploaded; only numbers.
- Sessions stay on the user's laptop.
- The SDK contacts Presage only to check the API key / credits.
- SDK telemetry is turned off (`enableTelemetry: false`).

## 10. Log of what's been done

| Date | What happened |
|---|---|
| 2026-11-11 | Researched the SDK and other entries; locked the idea (Gut Check) and tech (Electron); wrote OVERVIEW + ROADMAP; created the project skeleton |
| 2026-11-11 | Installed Electron 45, SDK 3.5, dotenv, esbuild. Built the **Signal Lab** test screen: camera preview + free fps check, live test with hard auto-stop, live vitals panel, automatic recording, and replay mode. Verified decoding with fake packets and that the app launches. No credits used yet. |
| 2026-11-11 | **First live test** (~1 credit): API key works; expressions, blinks and breathing waveform arrive. But only 10 frames/s reached the SDK (camera gave 20 in dim light), so it stopped after ~10 s. Moved the SDK camera into the main process, added a device check, a manual-exposure experiment, and an fps warning before starting. Fixed expression % display (scores are already percentages). |
| 2026-11-11 | Added a camera picker. **Second live test** with the phone camera (Samsung S21 Ultra via Windows Phone Link), 90 s, ~3 credits: **steady 30 fps, all signals arrived.** See "What real data taught us" below. |

## What real data taught us (Nov 11 live test)

| Signal | Behaviour | Design decision |
|---|---|---|
| Pulse | Stable after ~10 s, but swings ±10 bpm between readings | Average over each phase; only count stable readings |
| Breathing | Stable after ~30 s, 14–18 /min | Use per phase, mostly the second half of each phase |
| HRV + stress index | First value only at ~60 s, low confidence | **Not** part of the per-option vote; shown as a whole-session bonus |
| Expressions | Neutral resting face read as "sad 85%" all session | Never use absolute values, only **change vs the user's own baseline** |
| Blinks | ~12 /min (normal) | Usable per phase (blink rate change) |

Confidence values from the SDK are on a 0–100 scale. The Baevsky stress index comes out small (~0.6), not in the textbook 50–150 range.

**Camera:** the laptop webcam gave only ~20 fps in indoor light. A phone used as a webcam (Windows Phone Link) gives a steady 30 fps and is the recommended setup for testing and the demo. The app works with any camera.
