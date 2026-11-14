# Consent and data handling

CrossRoads reads signals from a camera, so this page says exactly what happens with them.

## Consent

- Before any measurement, the app explains what it does right beside the two options and asks for an explicit tick: *"I understand and want to continue."* The **Continue to camera** button stays disabled until then.
- The camera is only on during the camera check and the session itself. A **REC** badge and the live preview show when it is measuring.
- Every session can be stopped at any time ("Stop session").
- CrossRoads is for **one person reflecting on their own decision**. It is not designed or allowed for measuring other people.

## What is processed and where

| Data | Where it goes |
|---|---|
| Camera video | Processed by the SmartSpectra SDK **inside the app on this computer**. Never saved, never uploaded by CrossRoads. |
| Preview image | A 320 px copy is shown in the window while measuring; never saved. |
| Vitals (pulse, breathing, HRV, blinks, expression scores) | Saved as numbers in the session file on this computer. |
| Your two options and an optional note about what you decided | Saved in the session file on this computer. |
| Presage API key | `.env` file (development) or encrypted with Windows `safeStorage` (installed app). Never in the repository. |

| Shared result card ("Save as image") | Saved only where you choose. Shows the two options, the answer, the date and (if you saved one) the option you chose, never pulse numbers. |
| Preferences (theme, Hide me, focus mode, last camera) | The app's local browser storage on this computer. |

Windows often names phone cameras after their owner ("Name's Phone"). CrossRoads shows, logs and saves camera names without that part.

## What leaves the computer

- **According to Presage**, the SDK contacts Presage's servers to check the API key and credits; video frames are processed locally.
- **SDK telemetry is switched off** (`enableTelemetry: false`).
- **Only seven measurements are requested** from the SDK: chest and abdomen breathing, breathing rate, pulse, HRV, blinks and expression scores ([`src/core/metrics.js`](../src/core/metrics.js)). Face landmarks, the blood-pressure trace and talking detection are never requested, and an automated test fails if the list grows.
- CrossRoads itself makes **no other network requests**: no analytics, no AI services, no accounts.
- We have **not** independently measured the SDK's network traffic; the statement above is Presage's.

## Where data is stored

| Copy | Folder |
|---|---|
| Installed app | `%APPDATA%\crossroads\sessions` and `\recordings` |
| Running from source | `sessions/` and `recordings/` in the project folder (git-ignored) |

**Settings → Open data folder** opens it.

## Retention and deletion

- Data is kept until **you** delete it. Nothing expires or syncs.
- **My decisions → Delete** removes one session and its paired recording.
- **Settings → Delete all my data** removes every session and recording.
- **Settings → Remove** deletes the stored API key.
- Uninstalling the app leaves the data folder in place; delete it by hand if you want everything gone.

## The bundled sample

The sample session (`samples/beach-vs-speech/`) is a real session recorded by the developer with consent, containing numbers only. The camera's device name was removed. Your own sessions are never added to it or shared.

## Not medical

CrossRoads is a general wellness and reflection tool. It does not diagnose, treat or monitor any condition, and it makes no medical claims. Presage's developer SDK is offered for general wellness use.
