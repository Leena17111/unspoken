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

