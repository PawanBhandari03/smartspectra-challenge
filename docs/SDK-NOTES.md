# What the SmartSpectra SDK taught us

Practical notes from building CrossRoads on `@smartspectra/node-sdk` 3.5.0 (Electron 45, Windows 11). Every number here comes from our own sessions.

## 1. Run the SDK in the main process

The Node SDK offers two Electron modes:

| Mode | How frames travel | Result on our laptop |
|---|---|---|
| Renderer `MediaStream` (`/renderer`, `bindSmartSpectraIpc`) | the window copies each 1280×720 RGBA frame (~3.6 MB) to the main process over a `MessagePort` | **10 frames/s** reached the SDK; after ~10 s it stopped with `kSustainedLowFrameRate` |
| Main process `useCamera(CameraSelection.byId(id), { width: 1280, height: 720, fps: 30 })` | the SDK captures natively | **steady 30 frames/s** |

We use native capture and still show a live preview: the SDK's `videoOutput` event delivers its frames, which we downscale to 320 px and send to the window at 10 fps.

## 2. Frame rate is mostly about light

- A basic laptop webcam gave **~20 fps in indoor light**: auto-exposure lengthens each frame. The SDK needs about 25+.
- A phone used as a webcam (Windows Phone Link) held **30 fps**.
- The SDK's own `frameSentThrough` count is the truth. The browser's measured preview frame rate for a virtual camera showed 60–118 fps, which tells you nothing.
- **Lighting changes expressions too:** at night a neutral face read "sad" 80–95%; in daylight the same face read "neutral" 86–92%.

## 3. Warm-up windows decide your session design

| Metric | First value | Becomes "stable" |
|---|---|---|
| Pulse | ~10 s | ~10–15 s (12 s rolling average) |
| Breathing rate | ~15 s | ~30 s (30 s average) |
| HRV (RMSSD, SDNN, Baevsky) | **~60 s** | in our sessions: never (confidence ~10/100) |
| Blinks, expressions | immediately | immediately |

Consequences for CrossRoads: each 40 s visit is scored only on its last 25 s, breathing is shown but not voted, and HRV is not used.

## 4. After a low-confidence dip, distrust the next readings

When confidence dropped to ~0–30 for a few seconds, the next readings often spiked: **93–97 bpm for a person resting at 62–78**, some of them flagged `stable` with confidence 80+. We now ignore readings for 10 s after any low-confidence stretch, plus a plausibility gate (no change faster than max(8 bpm, 3.5 bpm/s)). Both filters are covered by tests.

## 5. Practical details

- **Confidence** in metric packets is on a 0–100 scale. **Expression scores** are percentages that sum to ~100.
- **Packets repeat history.** Blink samples arrive in overlapping batches; de-duplicate by timestamp (`BlinkCounter`). Store each pulse value once per new timestamp.
- **Timestamps** may be 64-bit `Long` objects after protobuf decoding; convert with `Number(v.toString())`.
- **Blink latency:** the SDK reports a blink within ~32 ms (median) of the frame it happened in. With Phone Link the on-screen preview itself lags a few seconds behind reality (Wi-Fi video buffering).
- **Camera choice:** `CameraSelection.front/back` fail on Windows (`kInputUnavailable`); use `availableCameras()` and `byId`. The browser and the SDK number cameras differently, so we match them by name.
- **Errors:** an `error` event is only fatal once processing status becomes `kError`; we stop, keep the partial session, and destroy/recreate the SDK before retrying.
- **Startup takes ~8 s** from `start()` to `kRunning`. Count auto-stop timers from `kRunning`, not from the click.
- **Credits:** the free trial had 100 credits (1 credit = 30 s of measurement). A 4-minute session costs about 8. Building CrossRoads used about 55.

## 6. Electron gotchas

- Some tools (including VS Code's integrated agents) set `ELECTRON_RUN_AS_NODE=1`, which makes Electron start as plain Node (`app` is undefined). `scripts/start.js` removes it before launching.
- If `npm install` skipped Electron's binary download, run `node node_modules/electron/install.js`.
- The SDK's renderer module uses `require`, so a sandboxed renderer needs a bundler (we use esbuild) and must import from `@smartspectra/node-sdk/renderer` or `/messages`, never the root (which pulls in the native FFI layer).
- The SDK loads native DLLs through FFI from real paths: package with `asar: false` (or a tested `asarUnpack`).
- `decodeMetrics` from `@smartspectra/node-sdk/messages` works in both processes; the root export only decodes once a Metrics class is registered.
