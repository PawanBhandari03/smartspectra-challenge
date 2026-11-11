# Gut Check — Roadmap

Deadline: **November 22, 2026**. Target: submit by **Nov 21 evening** to leave a safety day.

Legend: `[ ]` to do · `[x]` done · 👤 = needs **you (Pawan)** · 💳 = spends Presage credits

---

## Phase 0 — Setup (Nov 11)
- [x] Research SDK, free tier, competitors
- [x] Lock idea (Gut Check) and tech (Electron + Node SDK)
- [x] Write OVERVIEW.md and ROADMAP.md
- [x] Create project skeleton (`package.json`, `.gitignore`, `.env.example`)
- [x] 👤 Install dependencies (`npm install`) — Electron 45 + SDK 3.5
- [x] 👤 Put API key into `.env`
- [x] 👤 Share the GitHub repo URL and push the first commits

## Phase 1 — First live test (Nov 11–12)
- [x] Minimal Electron window that opens ("Signal Lab" test screen)
- [x] Connect SDK: camera preview + live vitals panel (pulse, breathing, HRV, stress, expression, blinks)
- [x] Free camera check: real frames-per-second measurement before spending credits
- [x] Hard auto-stop timer (30/60/90 s) + stop on any SDK error
- [x] Session recorder: every SDK event saved to `recordings/*.jsonl`
- [x] 💳 👤 First live test: key works, expressions + blinks arrive; frame rate too low (10/s) → SDK stopped
- [x] Fix: SDK captures the camera natively in the main process (no frame copying)
- [x] Camera picker (phone camera via Windows Phone Link works: steady 30 fps)
- [x] 💳 👤 Second live test (90 s): all signals arrive; HRV only after ~60 s (→ whole-session bonus, not per option)
- [ ] 💳 👤 Record 2–3 real Gut Check sessions — **moved to after Phase 2**, so the recordings include the real phase timings (saves credits)

## Phase 2 — Replay mode + full flow (Nov 13–15)
- [x] Replay mode: play a recorded session as if live (0 credits) — built early in Phase 1
- [ ] Screen: enter options
- [ ] Screen: consent / privacy
- [ ] Screen: camera check with guide oval + lighting hints
- [ ] Screen: baseline (60 s countdown)
- [ ] Screen: guided visualization per option (prompts every ~15 s, random order)
- [ ] Screen: automatic 20 s reset
- [ ] Stop measurement immediately when the session ends

## Phase 3 — Scoring + Body Vote (Nov 16–17)
- [ ] Collect per-phase readings (only reliable / stable ones)
- [ ] Compute changes vs baseline (pulse, breathing, HRV, expressions, blinks)
- [ ] Calm ↔ tense score per option
- [ ] Verdict: leaned toward X / too close to call / not enough signal
- [ ] Result screen with Chart.js timeline + per-signal breakdown
- [ ] Reflection questions based on what reacted

## Phase 4 — Polish (Nov 18–19)
- [ ] Visual design (colours, fonts, animations)
- [ ] Optional AI reflection (Presage "insights", free)
- [ ] Session history: view and compare past sessions
- [ ] Error handling: bad lighting, face lost, low frame rate
- [ ] App name + icon finalised 👤

## Phase 5 — Real tests (Nov 20)
- [ ] 💳 👤 2–3 full live runs end-to-end
- [ ] Fix what breaks
- [ ] Optional: Windows installer (`.exe`) for judges

## Phase 6 — Submission (Nov 21–22)
- [ ] README.md: what it is, screenshots, setup steps
- [ ] 💳 👤 Record demo video (2–3 min) — a real decision, body reacting live
- [ ] 👤 Upload video (YouTube, unlisted or public)
- [ ] Draft the DEV.to post (story, science, how it works, honest limits)
- [ ] 👤 Publish on DEV.to with `#presagechallenge` and submit

---

## What we need from you (Pawan)

| When | What |
|---|---|
| Now | Run `npm install` (instructions in chat), put the API key in `.env`, send the GitHub repo URL |
| Live tests | Sit in front of the webcam with good lighting (face a window/lamp, nothing bright behind you) |
| Recording sessions | 2–3 real decisions you're happy to show (real ones feel more genuine in the demo) |
| Before Phase 4 | Pick the final app name |
| Phase 6 | Record the demo video, publish the DEV.to post (it's your account) |

## Credit tracker (100 credits = ~50 min)

| Date | Used for | Credits | Left |
|---|---|---|---|
| — | start | 0 | 100 |
| Nov 11 | First live test (18 s) + second live test (90 s) | 3 | **97** (dashboard) |

A 90 s test costs about 2–3 credits, cheaper than the "1 credit per 30 s from the click" estimate (startup time seems not to count).
