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
- [x] 💳 👤 Record 2–3 real Gut Check sessions — done in Phases 2–3 (see the tests below)

## Phase 2 — Replay mode + full flow (Nov 13–15)
- [x] Replay mode: play a recorded session as if live (0 credits) — built early in Phase 1
- [x] Screen: welcome
- [x] Screen: enter options (2–3, optional detail)
- [x] Screen: consent / privacy
- [x] Screen: camera check (camera picker, preview, guide oval, tips) + Live / Demo choice
- [x] Session: settle phase gated on real signal quality (frames, face, pulse)
- [x] Session: calm baseline (neutral visualization), options in random order (prompts every 15 s), 20 s resets, end baseline
- [x] Session: progress bar, friendly guidance hints, small live thumbnail with REC, stop button
- [x] Recording streamed to disk every 2 s; session JSON with full time series saved
- [x] Stop measurement immediately when the session ends
- [x] First results table (changes vs baseline)
- [x] 💳 👤 **Null test:** tea vs coffee (Nov 11 night, then again with the ABBA design on Nov 12)
- [x] 💳 👤 **Real decision test:** stay in my city vs move to Bangalore (Nov 11 night, then ABBA on Nov 12)

## Phase 3 — Scoring + results ("a mirror, not a verdict") — done early (Nov 11)
- [x] Control experiment (tea vs coffee) + real decision → single visits can't tell options apart (see OVERVIEW)
- [x] Redesign: 2 options × 2 visits in mirrored order (A B B A), ~4 min, faster option-specific prompts
- [x] Pulse-only comparison: median of stable, confident readings; quality check per visit
- [x] Verdict calibrated on real data: names a calmer option only if both rounds agree by > max(wobble, 6 bpm); otherwise "Your body didn't pick a side"
- [x] Decision with Pawan: **a mirror, not a verdict**
- [x] Results screen: option cards, pulse timeline (hover shows the prompt on screen), "moments your body reacted", reflection questions, method + limits
- [x] 💳 👤 ABBA null test (tea vs coffee) → "didn't pick a side" ✓ (Nov 12)
- [x] 💳 👤 ABBA real decision session → "didn't pick a side" (rounds inconsistent) (Nov 12)
- [x] Fix: ignore readings for 10 s after a low-confidence stretch (SDK spikes afterwards)
- [x] 💳 👤 Positive control (beach vs speech) → "calmer with the beach" in both rounds ✓ (Nov 12)

## Phase 4 — Polish (Nov 18–19)
- [x] Visual design: colour brand, top bar + navigation, new welcome page, coloured signal tiles
- [x] Session screen with the Signal Lab layout: live camera, live vitals, session log, focus mode
- [ ] Optional AI reflection (Presage "insights", free)
- [x] Session history: reopen past sessions (the "Journal")
- [x] Bundled sample session (beach vs speech, camera name redacted): real results + scripted replay, no camera or key needed
- [x] Automated tests (21, `npm test`) + GitHub Actions CI
- [x] Plausibility gate for impossible pulse jumps (all real verdicts unchanged)
- [x] Settings: own Presage key stored encrypted (safeStorage); data folder; delete one session or all data
- [x] "What did you decide?" saved to the journal
- [x] Reduced-motion support
- [x] Windows installer + portable exe (`npm run dist` → `release/`), checked: no key, no personal data inside, SDK loads
- [x] 👤 Installed it: sample OK, key saved in Settings, 30 s Signal Lab live test OK, recording saved to `%APPDATA%\gut-check` (Nov 12)
- [x] Error handling: guidance hints (too dark, face lost, move closer…), settle phase gives up after 90 s and says why, stops on SDK errors, keeps partial sessions, low-confidence/spike filtering, "not enough signal" verdict
- [x] Icon finalised (journal logo, taskbar + installer)
- [ ] 👤 Confirm the final app name ("Gut Check")
- Validation sessions are backed up outside the repo in `Dev/Projects/gutcheck-backup-2026-11-12` (test "Delete" only in the installed copy)

## Phase 5 — Real tests
- [x] 💳 👤 3 full live ABBA sessions end-to-end: control (tea/coffee), real decision (city/Bangalore), positive control (beach/speech)
- [x] Fix what broke: phone camera instead of laptop (fps), night lighting ("sad" bias), SDK spikes after low confidence, single-visit drift → ABBA
- [x] Windows installer (`.exe`) for judges, tested installed
- [ ] 💳 👤 One full Gut Check in the **installed** app with the latest code (session flow was refactored after the last full live run). Can double as demo-video take 1.
- Known limit: the phone camera via Phone Link shows blinks ~5 s late on screen (Wi-Fi video buffering; the SDK itself reports blinks within ~30 ms). Doesn't affect results.

## Phase 6 — Submission (Nov 21–22)
- [ ] README.md: what it is, screenshots, setup steps, "How judges can test", SmartScreen note
- [ ] 👤 Publish GitHub Release v1.0 with the installer + portable exe
- [ ] 👤 Make the GitHub repo **public** (rules require it; it is private now)
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
| Nov 11–12 | Lab tests, 2 night sessions, 3 ABBA sessions, installed-app test | 52 | **45** (dashboard, Nov 12 4:19 PM) |

**Budget for the rest:** one full installed-app session (~8, can be video take 1) + one more video take (~8) + ~10 buffer. No other live tests.

A 90 s test costs about 2–3 credits, cheaper than the "1 credit per 30 s from the click" estimate (startup time seems not to count).
