# Evaluation

Unspoken reports two kinds of evidence, and never mixes them:

1. **Simulation** (reproducible, no humans): `npm run eval` writes everything below to `docs/results/`.
2. **Live trials** (real camera, real people): run in the developer **Lab** (`npm run dev`, open `#/lab`), exported as JSON. These are healthy volunteers, **not patients**. The Lab is excluded from the public build.

## Method

**Communication effort.** 30 scripted ICU-style exchanges (`src/core/evaluation.ts`), each with a caregiver question, the message the patient wants to convey, and an acceptance pattern. The effort model counts scan steps and deliberate selections for an idealised single-switch user (no mistakes):
- *Letter-board scanning*: row–column scanning of the same frequency-ordered board, no prediction
- *Letter board + word prediction*: the same board with Unspoken's local word prediction
- *Unspoken*: pick the matching suggestion if one conveys the message, otherwise "Spell it myself" and spell with prediction; plus one confirmation

**Blink detection.** Simulated eye-closure signals at 30 fps with ~17 natural blinks/min (100–400 ms), ~4 deliberate blinks/min (0.8–1.4 s) and Gaussian sensor noise. Unspoken is calibrated on a separate 15-second recording, exactly as in the app's wizard. Baselines use a fixed threshold of 0.5 on the raw signal, with or without a 550 ms minimum.

**Limitations of the simulation.** Idealised users make no errors and need no thinking time. The acceptance patterns were written by the author and judge whether a suggestion *conveys* the target, which is lenient. Synthetic eye signals are simpler than real ones. The simulation is for comparing designs, not for claiming real-world speed.

## 1. Communication effort (simulated, 30 scripted exchanges)

Parameters: 1.3 s per scan step, 0.9 s per deliberate blink, idealised user.

| Method | Avg. time / message | Avg. selections | Covered without spelling |
|---|---|---|---|
| Letter-board scanning | 118.6 s | 28.9 | 0% |
| Letter board + word prediction | 68.6 s | 16.1 | 0% |
| **Unspoken (offline phrases)** | **29.4 s** | **7.0** | 73% |

Unspoken is 75% faster than conventional letter-board scanning and 57% faster than a board with word prediction in this simulation.

Not covered by the offline phrases (fall back to spelling): “Where does it hurt?” → “My chest”; “Is the pain getting better or worse?” → “Better”; “Do you know where you are?” → “Yes in hospital”; “What is wrong?” → “I cannot breathe well”; “Your wife is here. Do you want to see her?” → “Yes please”; “Are you feeling sick?” → “A little”; “Anything you want to tell your daughter?” → “Tell her I love her”; “Are you worried about something?” → “I am worried about money”.

## 2. Ablation: how many suggestions should a blink user see?

More suggestions cover more messages, but every extra tile costs a scan step for every message.

| Suggestions shown | Coverage | Avg. time / message |
|---|---|---|
| 1 | 43% | 48.6 s |
| 2 | 67% | 31.1 s |
| 3 | 70% | 30.3 s |
| 4 | 73% | 29.4 s |

### Sensitivity to scan speed

| Scan step | Letter board | Unspoken | Time saved |
|---|---|---|---|
| 0.8 s | 83.0 s | 20.5 s | 75% |
| 1.3 s | 118.6 s | 29.4 s | 75% |
| 2.0 s | 168.4 s | 41.9 s | 75% |

## 3. Blink detection on simulated eye signals

10 simulated minutes per condition: ~17 natural blinks/min (100–400 ms) and ~4 deliberate blinks/min (0.8–1.4 s), Gaussian sensor noise. Unspoken is calibrated on a separate 15 s recording (relaxed + eyes closed), exactly like the in-app wizard.

| Condition | Detector | Deliberate blinks detected | False selections / min |
|---|---|---|---|
| Typical (noise 0.04, open 0.08) | Naive: any blink selects | 100% | 13.60 |
| Typical (noise 0.04, open 0.08) | Naive + 550 ms minimum | 100% | 0.00 |
| Typical (noise 0.04, open 0.08) | Unspoken (calibrated, smoothed, hysteresis) | 100% | 0.00 |
| Noisy camera (noise 0.10) | Naive: any blink selects | 100% | 15.20 |
| Noisy camera (noise 0.10) | Naive + 550 ms minimum | 92% | 0.00 |
| Noisy camera (noise 0.10) | Unspoken (calibrated, smoothed, hysteresis) | 100% | 0.00 |
| Droopy eyelids (open 0.30) | Naive: any blink selects | 100% | 14.60 |
| Droopy eyelids (open 0.30) | Naive + 550 ms minimum | 100% | 0.00 |
| Droopy eyelids (open 0.30) | Unspoken (calibrated, smoothed, hysteresis) | 100% | 0.00 |
| Very droopy eyelids (open 0.48) | Naive: any blink selects | 100% | 345.10 |
| Very droopy eyelids (open 0.48) | Naive + 550 ms minimum | 100% | 0.00 |
| Very droopy eyelids (open 0.48) | Unspoken (calibrated, smoothed, hysteresis) | 100% | 0.00 |
| Very droopy + noisy (open 0.48, noise 0.08) | Naive: any blink selects | 97% | 389.90 |
| Very droopy + noisy (open 0.48, noise 0.08) | Naive + 550 ms minimum | 97% | 0.00 |
| Very droopy + noisy (open 0.48, noise 0.08) | Unspoken (calibrated, smoothed, hysteresis) | 97% | 0.00 |
| Weak eye closure (closed only 0.42; e.g. weak lids or glasses glare) | Naive: any blink selects | 58% | 1.60 |
| Weak eye closure (closed only 0.42; e.g. weak lids or glasses glare) | Naive + 550 ms minimum | 0% | 0.00 |
| Weak eye closure (closed only 0.42; e.g. weak lids or glasses glare) | Unspoken (calibrated, smoothed, hysteresis) | 100% | 0.00 |

These are simulated signals, used to compare detectors under controlled conditions. Real-world rates must be measured with the in-app 60-second false-selection test.


### What the ablations show

- **The minimum hold time does most of the work** against false selections; this is the single most important rule.
- **Smoothing and hysteresis** stop sensor noise from splitting a long blink in two (92% → 100% detection on a noisy camera).
- **Per-person calibration** is what makes the system usable for people whose eyes do not close fully on camera: a fixed threshold detects **0%** of their deliberate blinks, while the calibrated detector detects 100%.
- **Four suggestions** is the best trade-off of those tested. Going from 1 to 2 suggestions gives the biggest gain; beyond 3 the gains are small, because each extra tile costs scan time on every message.

### Bug found by this evaluation

The first version of calibration counted *any* closure in the "blink normally" phase as a natural blink. One long blink there raised the required hold time above every deliberate blink, so detection fell to **0%** in two conditions. Natural-blink estimation now ignores closures over 550 ms and the threshold is capped at 1 s. A regression test covers this (`tests/eyeSignal.test.ts`).

## AI suggestions (needs an API key)

Set a key in **About → Staff setup**, then in the Lab click **Run with AI suggestions**. The same 30 scenarios run through the configured model, reporting coverage, time per message and median latency next to the offline baseline. Download the JSON and add it to `docs/results/`.

## Live trial protocol (developer Lab)

1. **Calibrate** for the participant (about 20 s).
2. **False-selection test:** 60 s of natural looking, reading and talking without trying to select. Report false selections per minute.
3. **Message trials:** for each chosen scenario, run it once with Unspoken and once spelling-only (counterbalance the order across participants). The app records time from the question to the spoken message, the number of selections, and whether the message matched the target.
4. Export with **Download all results**.

Report the participants (healthy volunteers), the lighting, the camera, and any failures. Do not present these as patient outcomes.
