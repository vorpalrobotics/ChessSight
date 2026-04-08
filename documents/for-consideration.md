# For Consideration: Figure of Merit for History Charts

*Tabled 2026-04-08. Revisit when ready to improve the History feature.*

---

## Background

The History screen currently charts raw average time and accuracy separately per drill.
The goal is a single combined figure of merit that is meaningful in a chess training context.

## The Core Tension

The user wants to win chess games — particularly speed chess. Two competing pressures:

- **Too slow** → clock flags, you lose on time
- **Too inaccurate** → you misanalyze and blunder

The "right" speed-accuracy tradeoff depends on the time control being trained for.
A 3-second miss is tolerable in rapid (15–20s/move budget) but costly in blitz (5–10s/move).

---

## Options Considered

### 1. Score per correct answer (accuracy-weighted speed)
```
score = correct / (seconds + penalty × misses)
```
Simple ratio of correct answers per effective second. Easy to explain.
**Downside:** very short sessions inflate the score artificially.

### 2. Points with time bonus
```
score = correct × basePoints − misses × missPenalty + max(0, timeBonusPool − seconds)
```
Game-like score. Satisfying but requires per-drill constant tuning and lacks absolute meaning.

### 3. Normalized composite (0–100)
```
score = w₁ × accuracy% + w₂ × (1 − normalizedTime)
```
Grade-like number using a per-drill "par" time. Intuitive but the par value is arbitrary.

### 4. Efficiency ratio
```
score = (correct / optimalPossible) / seconds
```
Natural for Knight Route (`pathLength / optimalDist / seconds`). Pure and unit-consistent.
**Downside:** produces small hard-to-read numbers like 0.04.

### 5. Penalty time (golf / speedrun style)
```
adjustedTime = seconds + misses × penaltySeconds
```
Lower is better. Readable: "you solved it in 45s adjusted."
Each mistake costs N phantom seconds. One tunable knob.

### 6. Chess-native: Expected Value per Move *(preferred candidate)*
```
adjustedTime = seconds + misses × targetSecondsPerMove
efficiency   = puzzleCount / adjustedTime
```
The penalty equals exactly what a wasted move costs in the chosen time control.
User sets **bullet / blitz / rapid / classical** → maps to penalty constant (e.g. 5 / 10 / 20 / 60s).
Misses are penalized in proportion to how much they hurt in the actual games being trained for.

---

## Implementation Sketch (option 6)

- Add a time control selector in Settings or the History modal: Bullet · Blitz · Rapid · Classical
- Store the selected time control in localStorage
- In history charts, plot `adjustedTime` (raw + misses × penalty) per session instead of raw time
- Optionally show both raw and adjusted lines to visualize accuracy cost visually

---

## Open Questions

- **Cross-drill comparability:** Drills differ enormously in cognitive load (Knight Route vs. Count Checks). The metric probably works best *within* a drill over time rather than *across* drills.
- **Penalty calibration:** Does a fixed penalty per time control feel right, or should it be user-adjustable?
- **Display format:** A single efficiency number trending upward over time is clean, but loses the raw time/accuracy breakdown that is itself informative.

---

## Decision

Tabled. No implementation yet. Revisit when the History feature is next prioritized.
