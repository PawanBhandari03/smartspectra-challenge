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
| 6 | Full check: two options → consent → camera check → session | Settle → baseline → 4 visits → results; session in the Journal | ✅ Nov 12 (dev build, 3 sessions) · ⏳ installed final build |
| 7 | Results → **What did you decide?** → Save | Choice shown on the result and in the Journal | ⏳ installed final build |
| 8 | Journal → **Delete** one session | Session and its recording removed | ⏳ installed final build |
| 9 | Bad lighting / face out of frame during settle | Guidance hint shown; after 90 s the session stops and says which check failed | ✅ Nov 11 (replay of a failing recording) |
| 10 | Installer contents | No API key, no sessions or recordings inside; SDK loads | ✅ Nov 12 (scripted scan) |

## Dated live sessions

| Date | Setup | Session | Outcome |
|---|---|---|---|
| Nov 11 | laptop webcam, renderer capture | 90 s Signal Lab | 10 fps reached the SDK → stopped (led to native capture) |
| Nov 11 | phone camera, native capture | 90 s Signal Lab | steady 30 fps, all signals |
| Nov 11 | phone, night | tea vs coffee, city vs Bangalore (single visits) | control failed → A B B A redesign |
| Nov 12 | phone, daylight | tea vs coffee (A B B A) | didn't pick a side ✓ |
| Nov 12 | phone, daylight | city vs Bangalore (A B B A) | didn't pick a side |
| Nov 12 | phone, daylight | beach vs speech (A B B A) | calmer with the beach ✓ (bundled as the sample) |
| Nov 12 | installed app | 30 s Signal Lab | recording saved to `%APPDATA%` ✓ |

## How to run the installer scan

After `npm run dist`:

```bash
# should print nothing: no key fragment inside the build
grep -rl "<first 8 characters of your key>" release/win-unpacked release/*.exe
# should list only assets, dist, node_modules, package.json, samples, src
ls release/win-unpacked/resources/app
```
