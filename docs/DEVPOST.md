# Devpost submission: Unspoken

**Deadline: 11 Nov 2026, 6:00 am (GMT+8).** Aim to submit by 2:00 am.

## Project name
Unspoken

## Short description
Eye-controlled, AI-assisted communication for patients who are awake but cannot speak. It runs on an ordinary webcam, and the patient chooses and confirms every message.

## Detailed description

### The problem
Patients on a ventilator, after a stroke, or living with motor neurone disease are often fully aware but cannot speak or write. Mechanically ventilated patients cannot talk because of the breathing tube, and a 2025 study in *Nursing in Critical Care* notes there is still no universally accepted tool for these "voiceless" patients to communicate. Being unable to communicate is linked to anxiety, panic, frustration and sleep disturbance. In one study of 2,671 ventilated ICU patients, more than half met basic criteria to use assistive communication tools.

Today they get yes/no questions, a laminated letter board, or, in a few hospitals, dedicated eye-tracking hardware. Spelling a sentence letter by letter takes minutes, so pain, thirst, fear and simple wishes often go unsaid.

### Why it matters
Communication is access to care itself. A patient who can't say where it hurts, that they're thirsty, or that they're scared can't take part in their own care. Unspoken removes that barrier with hardware every clinic already has: a laptop with a webcam.

### How it works
1. **Eye input on any webcam.** MediaPipe face tracking runs entirely in the browser. Unspoken's own signal processing is calibrated to each person in about 20 seconds. It separates a deliberate long blink from natural blinking (people blink ~15–20 times a minute), with smoothing, hysteresis, a refractory period, rest detection, a visible "hold" bar and audio cues that work with eyes closed. Glance-left/right and single-switch modes are also available.
2. **Conversation-aware replies.** When the caregiver speaks, speech recognition captures the question. Unspoken shows quick replies instantly, then upgrades them to AI suggestions grounded in the conversation, so a sentence takes a few selections instead of dozens.
3. **The patient stays in control.** "Spell it myself" and "None of these" are always available. Nothing is spoken until the patient confirms. Code-level guardrails mean yes/no questions always offer both answers, doses or treatment decisions are never suggested, and malformed AI output falls back to offline phrases.
4. **Structured pain reporting:** where it hurts, then how bad (0–10), with a step indicator so the patient always knows where they are. Reports appear in a simple conversation history for the next person at the bedside.
5. **Independent spelling:** a row–column scanning keyboard with word prediction that works offline.

### Evidence (all reproducible from the repo)
- **Simulated communication effort** on 30 scripted ICU exchanges: average time per message fell from **118.6 s** with a conventional letter board to **29.4 s** with Unspoken using offline phrases only, **75% less**, before any AI.
- **Blink-detector study** on simulated eye signals: a naive "any blink selects" detector makes ~14 false selections per minute. In a weak-eye-closure condition (e.g. glasses glare), a fixed-threshold detector catches **0%** of deliberate blinks, while Unspoken's calibrated detector catches **100% with zero false selections**.
- The evaluation found a real calibration bug, which was fixed with a regression test.
- 33 unit tests, a keyboard-only end-to-end test, and **0 axe WCAG 2.1 AA violations** on every screen.
- A developer Lab (kept out of the public app) for live trials: a 60-second false-selection test and timed message trials comparing Unspoken with spelling-only.
- The public app is deliberately simple: Talk, History, Preferences, About. A first-time caregiver is asked one question (how will the patient choose?) and can start straight away.

### Honest limitations
Unspoken is a prototype tested with healthy volunteers, not patients, and it is not a medical device. Webcam blink detection depends on lighting and positioning. The attention chime is not a nurse-call system.

### What's next
Validation with speech-language pathologists and ICU nurses; Malay, Tamil and Mandarin phrase sets; personal vocabularies; a caregiver phone view; and a study with patients under ethical approval.

## Technologies used
TypeScript, React, Vite, MediaPipe Face Landmarker (WebAssembly/WebGL), Web Speech API (speech recognition and synthesis), LLM APIs (Groq / Gemini / OpenAI / Anthropic, browser-direct), zod, Vitest, Playwright, axe-core, GitHub Actions, GitHub Pages

## Links
- Live app: https://leena17111.github.io/unspoken/
- Code: https://github.com/Leena17111/unspoken

---

# Demo video script (about 2:50)

**Before recording:** good light in front of your face; laptop at eye level; calibrate once; choose *With their eyes* on the welcome screen and complete the 20-second eye setup; in Preferences pick *Normal* speed; add an AI key in About → Staff setup (Groq is fastest); close other tabs; screen recorder on (Win + Alt + R, or OBS) with the microphone on. A friend plays the nurse. You keep your hands in your lap the whole time.

**0:00–0:20 · Hook** (black screen or your face, then the app)
> "Imagine waking up in intensive care with a tube in your throat. You can hear everything. You understand everything. But you can't say a word. Not that you're in pain. Not that you're scared. This happens to thousands of ventilated patients every day."

**0:20–0:35 · The status quo** (hold up a paper letter board, or show the spelling screen)
> "Today they usually get yes/no questions or a letter board. Spelling one sentence can take two minutes."

**0:35–1:25 · The live demo** (hands visibly in lap)
- Nurse (friend): *"Are you in pain?"*: the question appears on screen and reply tiles appear.
- You: long blink on **"Yes, I am in pain"** → body map → long blink on **Chest** → **Severe** → **7** → **Say it**.
- The laptop speaks: *"My chest hurts. Pain 7 out of 10."*
> (voice-over) "No hands, no special hardware. Just a webcam, and every word confirmed by the patient."

**1:25–1:50 · Control and safety**
- Nurse: *"Do you want me to call your family?"*: show that both yes and no are offered.
- Pick **"Spell it myself"** and spell one short word with prediction (e.g. "c" → **cold**).
> "The AI only suggests. Spelling is always there, nothing is said without confirmation, and yes/no questions always get both answers."

**1:50–2:15 · How it works** (show Preferences → Set up eye control briefly, then the eye-status bar filling during a held blink)
> "People blink 15 to 20 times a minute, so a naive system would click constantly. Unspoken calibrates to each person, ignores natural blinks, and only accepts a deliberate, held blink, with sound cues that work with your eyes closed."

**2:15–2:40 · Evidence** (show the README results tables on GitHub, then the History page)
> "In our simulation of 30 ICU conversations, Unspoken cut the time per message by 75% compared with a letter board, even before AI. And when someone's eyes don't close fully on camera, a fixed-threshold detector misses every blink; our calibrated detector catches all of them. Everything the patient confirms appears in a simple history, with their pain reports, for the next person at the bedside."

**2:40–2:50 · Close**
> "Unspoken: one webcam, and a patient's voice back. The code, tests and evaluation are open on GitHub."

## Checklist
- [ ] GitHub Pages enabled (Settings → Pages → Source: GitHub Actions) and the live link works
- [ ] Tested on your laptop: welcome → eyes → eye setup → practice in Preferences → a full pain report by blinking
- [ ] Optional: run `npm run dev`, open `#/lab`, *Run with AI suggestions*, and send the JSON to Claude to add to the docs
- [ ] Video recorded and uploaded to YouTube as **Unlisted**
- [ ] Devpost: name, short description, detailed description, technologies, video, links, screenshots from `docs/screenshots/` (welcome, answers, where, confirm, history)
- [ ] Submit before 6:00 am GMT+8
