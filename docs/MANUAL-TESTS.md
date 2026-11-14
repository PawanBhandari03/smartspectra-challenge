# Manual tests

Checks that need a real camera, a real API key or the installed app, with the dated results. Automated tests (`npm test`) cover the analysis, the session plan and SDK decoding.

## Checklist

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | Open the app → **Try the sample** | Results say "Your body stayed calmer with 'A quiet afternoon at the beach'" | ✅ Nov 12 (dev + installed) |
| 2 | Sample → **Watch the replay** | Recorded session plays at 5× with live tiles; returns to the same result | ✅ Nov 12 |
| 3 | Settings → paste key → **Save key** | Status "Saved (encrypted on this computer)" | ✅ Nov 12 (installed) |
| 4 | Signal Lab → phone camera → 30 s live test | Pulse, breathing, blinks, expression appear; stops by itself; recording saved | ✅ Nov 12 (installed) |
| 5 | Settings → **Open data folder** | `%APPDATA%\crossroads` opens, recording present | ✅ Nov 12 (installed; the folder was `gut-check` before the rename) |
| 6 | Full check: two options → consent → camera check → session | Settle → baseline → 4 visits → results; session in My decisions | ✅ Nov 12 (dev build, 3 sessions; installed CrossRoads 1.0.0, 1 session) |
| 7 | Results → **What did you decide?** → Save | Choice shown on the result and in My decisions | ✅ Nov 12 (installed; choice saved in the session file) |
| 8 | My decisions → **Delete** one session | Session and its recording removed | ✅ Nov 12 (installed 1.0.0: confirmation names both options and the date, session removed) |
| 9 | Bad lighting / face out of frame during settle | Guidance hint shown; after 90 s the session stops and says which check failed | ✅ Nov 11 (replay of a failing recording) |
| 10 | Installer contents | No API key, no sessions or recordings inside; SDK loads | ✅ Nov 12 (scripted scan) |
| 11 | Camera check steps + **Hide me** | Steps tick Camera on / Smooth / Light / Ready; Hide me blurs only the preview | ✅ Nov 13 (dev, webcam preview; live SDK run pending) |
| 12 | Results → **Save as image** | Save dialog; PNG with options, answer, date, no pulse numbers | ✅ Nov 13 (card rendered and checked; dialog path pending on installer) |
| 13 | Results → save a decision → **Change my answer** | "You decided" record replaces the form; My decisions shows the line and the match summary | ✅ Nov 13 (dev) |
| 14 | Dark mode (moon button / Settings) | Every screen, chart and Signal Lab follow the theme; choice remembered | ✅ Nov 13 (dev screenshots) |
| 15 | Phone camera name | Signal Lab log and camera list show "S21 Ultra (Windows Virtual Camera)", no owner name | ✅ Nov 13 (dev) |

## Dated live sessions

| Date | Setup | Session | Outcome |
|---|---|---|---|
| Nov 11 | laptop webcam, renderer capture | 90 s Signal Lab | 10 fps reached the SDK → stopped (led to native capture) |
| Nov 11 | phone camera, native capture | 90 s Signal Lab | steady 30 fps, all signals |
| Nov 11 | phone, night | tea vs coffee, city vs Bangalore (single visits) | control failed → A B B A redesign |
| Nov 12 | phone, daylight | tea vs coffee (A B B A) | didn't pick a side ✓ |
| Nov 12 | phone, daylight | city vs Bangalore (A B B A) | didn't pick a side |
| Nov 12 | phone, daylight | beach vs speech (A B B A) | calmer with the beach ✓ (bundled as the sample) |
| Nov 12 | installed app | 30 s Signal Lab | recording saved to the app data folder ✓ |
| Nov 12 (5:45 PM) | installed CrossRoads 1.0.0 | beach vs speech again (A B B A) | excellent signal (98% stable, confidence 83); didn't pick a side (rounds disagreed: +2.1, −7.5 bpm); session, recording and choice saved ✓ |
| Nov 14 | phone, daylight (dev build) | city vs Bangalore again (A B B A) | 79% stable, 30 fps; rounds −0.3 / +0.3 bpm → didn't pick a side; decision saved, Save as image ✓ |
| Nov 14 | phone, daylight (dev build) | master's abroad vs start working (A B B A) | 92% stable; rounds +2.1 / −8.0 → no clear winner; biggest jump +8.4 bpm at "what did you give up for it?" (led to the tie wording change) |
| Nov 14 | phone, daylight (dev build) | tell my parents vs keep going (A B B A) | 87% stable; rounds +10.7 / +9.4 → calmer with "keep going"; decision saved ✓ |
| Nov 14 | dev build, empty profile | no key / made-up key, real server | up-front notice; red message at Begin session; wrong key answered "Invalid or missing API key" and the app showed the plain-language message ✓ |
| Nov 14 | installer build 1.0.0 | `npm run dist`, then key scan | no key prefix (old or spare) in the installer, the portable exe or the unpacked app; no .env, sessions or recordings inside ✓ |
| Nov 14 | installed app (Setup exe) | install, spare key in Settings, sample, a real session, Save as image | works ✓ (My decisions starts empty; data lives in %APPDATA%\crossroads) |

## How to run the installer scan

After `npm run dist`:

```bash
# should print nothing: no key fragment inside the build
grep -rl "<first 8 characters of your key>" release/win-unpacked release/*.exe
# should list only assets, dist, node_modules, package.json, samples, src
ls release/win-unpacked/resources/app
```
