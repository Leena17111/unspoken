# Design

## The core idea

A patient who can only blink can make roughly one choice every few seconds. Conventional letter-board scanning spends that tiny bandwidth on individual letters. Unspoken spends it on **meaning**: it uses the caregiver's question as context and offers the few replies the patient is most likely to want, while keeping a full independent spelling channel for everything else.

## 1. Eye input (`src/core/eyeSignal.ts`)

MediaPipe Face Landmarker returns 52 blendshapes per frame. Unspoken uses six: `eyeBlinkLeft/Right` and `eyeLookIn/Out Left/Right`.

| Problem | Solution |
|---|---|
| People blink ~15–20×/min | A selection requires a closure longer than a **per-person minimum** (1.8× their longest natural blink, 450–1000 ms) |
| Sensor noise splits one long blink into several short ones | Exponential smoothing + **hysteresis** (enter "closed" at 60% of the calibrated range, leave at 35%) |
| Different faces, eyelids, glasses, camera angles | **Calibration** learns each person's open and closed levels; thresholds are relative to that range |
| Resting with eyes closed | Closures over 4 s are treated as rest, not selection |
| Accidental double selections | Refractory period (700 ms) |
| Feedback with eyes closed | A "hold" bar fills on the highlighted tile, and audio cues confirm |
| Gaze jitter | Side glance must pass a calibrated threshold and be held for 650 ms; one event per glance; must return to centre |

Calibration (`calibrate()`) records about 15 s: relaxed looking with natural blinks, eyes closed, glance left, glance right. It reports quality issues (face not visible, open vs closed too similar, glances indistinguishable) instead of silently producing a bad profile.

## 2. Selection (`src/core/scanner.ts`)

Standard AAC access methods:
- **Auto-scan**: the highlight moves by itself and one deliberate action selects. This needs only one reliable movement (blink or switch).
- **Gaze stepping**: glance left/right to move, blink to select.

Scanning pauses after three idle cycles so a resting patient isn't exposed to a constantly moving highlight; the first action only wakes it.

## 3. Reply suggestions (`src/core/options.ts`)

1. **Deterministic question typing** (pain / yes-no / feeling / need / location / choice / greeting / open).
2. **Instant offline phrases** for that type, so nothing waits on a network call.
3. **LLM suggestions** (optional) with the conversation history and a care-context note. The browser calls the provider directly with the user's own key: Groq, Gemini, OpenAI, Anthropic or any OpenAI-compatible API.
4. **Guardrails, enforced in code** and never left to the model:
   - zod schema validation; anything that isn't valid JSON falls back to offline phrases
   - at most 4 suggestions, at most 10 words each, de-duplicated
   - **neutrality**: yes/no and pain questions always include both a yes and a no answer
   - **safety**: no doses, no "stop treatment / turn off the machine". These can still be *spelled* deliberately, but are never *suggested*.
   - 5 s timeout, then fallback
   - AI suggestions replace the instant ones only if the patient hasn't started selecting
5. "Spell it myself" and "None of these" are fixed tiles, never generated.

## 4. Spelling (`src/core/spelling.ts`)

Row–column scanning with a frequency-ordered layout (␣ E T A O I N first) and a prediction row. Prediction is a small hand-curated lexicon of everyday and hospital words with simple context rules (after "my": body parts and family; after "I": am / want / need…). It is deterministic and works offline.

## 5. Safety and consent

- Every message goes through **Say this?** → *Say it / Change it / Cancel*.
- Structured pain reports are logged with location and score; nothing is inferred.
- "Get attention" plays a chime and shows a banner that says it is **not a nurse call**.
- The system never infers a disability or emotion from behaviour; the caregiver chooses the input mode.

## 6. Privacy

- Video frames are processed in the browser by WebAssembly/WebGL and are never stored or uploaded.
- Settings, calibration and the conversation log live in `localStorage` on this device only.
- With AI enabled, only text is sent (caregiver words, recent conversation, care-context note), and only to the provider the user configured.

## 7. Accessibility of the app itself

- Patient screen: large tiles (22–30 px text), high contrast, an unambiguous highlight, `prefers-reduced-motion` support.
- Caregiver UI: labelled controls, keyboard operable, visible focus, live regions for status.
- `npm run e2e` drives the whole flow by keyboard only and runs axe-core (WCAG 2.1 A/AA) on every view: 0 violations at the time of writing.

## 8. Testing

| Layer | How |
|---|---|
| Signal processing and calibration | Unit tests on synthetic eye signals (`tests/eyeSignal.test.ts`) |
| Scanning, guardrails, spelling, effort model | Unit tests (`tests/*.test.ts`), including mocked malformed and valid LLM output |
| Whole app | `e2e/run.mjs`: single-switch user completes the pain report, a spelled message and an attention request; timeline and evaluation render; axe checks |
| CI | GitHub Actions runs tests, type-check and build, then deploys to GitHub Pages |

## Related work

- **EyeControl** (EyeFree): FDA-listed wearable eye-tracking communication device for ventilated ICU patients. It is dedicated hardware, while Unspoken needs only a webcam.
- **Speak Ease** (Xu et al., 2025) and **SocializeChat**: LLM-assisted AAC that uses conversation context, aimed at users who can type or tap. Unspoken targets users with a single, slow, binary input channel and adds blink detection, scanning and clinical structure.
- **Letter boards and switch scanning**: the established baseline used in the evaluation.
