# Tuning from telemetry

This is the v0.80 evidence pass. It uses the archived production spans, not a
fresh live session: at the time of the pass the world had 11 accounts and no
active connections. The numbers are still useful because they are real turns
and real combat rounds, not a hand-written scenario.

## Sample

- 1,440,758 spans across the current journal and two archives.
- 2,305 AI turns.
- 152 combat rounds.
- 138 talk events.
- Providers: 2,182 Gemini-demo turns, 112 Ollama turns, 11 prime-router turns.

## AI loop

| Measure | Result |
| --- | --- |
| Parse success | 2,290 / 2,305 = **99.3%** |
| Timeouts | 1 |
| Latency p50 | **980 ms** |
| Latency p95 | **2,695 ms** |
| Most common commands | examine, look, talk, take, east, north, search, west, south, inventory |
| Talk events | 138, led by the guard, innkeeper, bard, guild clerk and market woman |

The model is exploring and talking, not only walking. The top command is
`examine`, which is the intended first-five-minutes behaviour. Parse failures
are rare enough that a prompt rewrite is not justified by this sample.

## Combat

| Measure | Result |
| --- | --- |
| Rounds | 152 |
| Hit rate | **50.7%** |
| Average damage on a hit | **1.42** |
| Player hits / misses / kills | 30 / 41 / 6 |
| Enemy hits / misses | 41 / 34 |
| Most common targets | vault guardian, sewer rat, rat |

The 50.7% hit rate is the expected shape of `57 - armour`: armour and the
d100 roll make a hit roughly a coin flip. The low average damage is the
unarmed/early band, not the level-10 band. The deterministic sampler still
shows the intended spread:

```
early     57–67%
mid       63–100%
high      56–61%
capstone  40–98%
```

The prepared caster is at the top of the capstone range; the underleveled
melee character is at the bottom. The level-10 melee character is the 50%
case. That is the intended difficulty, so v0.80 does not change status
durations, aggression or the regent's 64 HP / 6 damage.

## Live session (v0.82)

The isolated level-10 run in `docs/LIVE-RUN.md` fought the eclipse regent for
**11 rounds**: 21 combat events, 9 hits, 11 misses and one kill, for a 47.6%
hit rate. The player dealt 66 damage and took 16, finishing at 6 / 28 hp. That
is the expected close fight the sampler predicted, so the regent's 64 hp / 6
damage stays.

The same run found a real progression defect: 30,000 XP produced level 11
because the table had eleven thresholds. The table is now ten levels ending at
30,000 XP, and the gate asserts the cap.

## Unscripted model run (v0.83)

`docs/UNSCRIPTED-RUN.md` records qwen2.5:7b against the isolated Memory Garden.
Before route memory, the model planted in both attempts but looped before the
hand-in. After the shared route ledger and loop guard, the third run finished
the Remembered Bed in seven turns: take rose, plant, down, take bloom, up,
north, talk. The BFS route and waypoint sequencer then completed the broader
Root Archive run in nine turns. Seeding the graph from `/llms.txt` and adding
the movement guard completed the town-spanning Long Remembering run in 13
turns. The server contract and the navigation guards both worked. The remote
DeepSeek runs then completed the Root Archive in 5 turns and all four Three
Rememberings objectives in 24 turns without local inference. The two-quest
Press Beneath / Clerk Errand run completed in 31 turns with an objective
dependency guard. The three-quest Press Beneath / Cider Spring / First Bed run
then completed in 23 turns with the route lock enabled; after objective
verification was added it completed in 24 turns with every action confirmed.

## Remote DeepSeek Mirror Pool (v0.91.19)

`tools/tuning-session.mjs` now runs a short remote-model session against an
isolated server. The character starts at the Mirror Pool with a mundane kit on
the floor; the model must take all, wield, wear, fight the mirror-wraith, take
the drop and wear the mirror shield. It uses OpenCode/DeepSeek, no local model.

| Run | Turns | Rounds | Hits | Misses | Hit rate | Avg damage | Kill | Shield taken/worn | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 16 | 9 | 4 | 5 | 44.4% | 5.0 | yes | yes / yes (pre-placed) | 0 |
| 2 | 12 | 5 | 5 | 0 | 100% | 4.4 | yes | yes / yes (drop) | 0 |
| **Both** | | **14** | **9** | **5** | **64.3%** | **4.67** | **2** | | **0** |

The first run took 2 damage; the second took none. The model used `take all`,
`wield`, `wear`, `attack` and `score`, and never tried to flee.

Live `/players` at the same point: 43 rounds, 25 hits, 18 misses, 58.1% hit
rate, 2.72 average damage, 0 player deaths, 0 PvP rounds.

## Deterministic PvP and unseeded bands (v0.91.20)

The sampler now includes player-versus-player and unseeded high-level fights:

| Scenario | Win | Rounds |
| --- | --- | --- |
| level 5 sword+jerkin mirror | 46% | 9.6 |
| level 5 spark / sword+jerkin | 41% | 10.2 |
| level 10 dawn blade+plate / ember brand+plate | 47% | 9.8 |
| level 8 unarmored / star hound | 51% | 15.7 |
| level 10 unarmored / regent | 18% | 24.9 |

The PvP mirror matchups sit near even, and the unseeded regent is deliberately
dangerous: 18% wins without gear. That is the intended shape, not a defect.
The Gate now runs the sampler at 120 seeds and fails if a PvP matchup leaves
25–75% or if the unseeded high-level bands fall outside their expected range.

### Unseeded level 8 (v0.91.26)

`TUNING_SCENARIO=high` starts an unseeded level-8 character at the Starless
Hall against the star hound. The first run was stopped by the 180-second wall
while the fight was still live:

| Measure | Result |
| --- | --- |
| Turns | 10 |
| Combat rounds | 18 |
| Hits / misses | 11 / 7 |
| Hit rate | 61.1% |
| Average damage | 2.82 |
| Star hound HP left | 10 / 28 |
| Character HP left | 36 / 55 |
| Player deaths | 0 |

The character was ahead, not in danger, when the wall stopped the run. That is
consistent with the deterministic 51% unseeded level-8 band and does not
justify a damage or armour change. A complete kill needs a longer wall or more
turns; the harness now defaults the high scenario to 300 seconds.

## Live two-client PvP (post-v0.91.32)

`tools/pvp-session.mjs` starts a fresh isolated server per match, puts both
characters in The Ring, gives each an identical mirrored kit, logs both in
through the real WebSocket, and runs the real `duel` → `duel accept` →
`attack` flow. The report is built from `world.session`, `world.combat` and
`world.duel` spans, not a reducer simulation.

```sh
node tools/pvp-session.mjs --level=5 --matches=8 --stagger=4000
node tools/pvp-session.mjs --level=10 --matches=8 --stagger=4000
```

| Level | Matches | Distinct outcomes | Attacks | Hits | Hit rate | Avg damage on hit | Exchange rounds | Winner HP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 8 | 2 | 240 | 96 | **40.0%** | **6.5** | **15** | **4 / 40** |
| 10 | 8 | 2 | 192 | 80 | **41.7%** | **11.4** | **12** | **11 / 65** |

- Level 5 kit: short sword, leather jerkin, iron helmet, boots, gloves and
  round shield (armour 7; `57 - armour` expects 50%).
- Level 10 kit: dawn blade, dawn crown, eclipse plate, ember cloak, shield,
  boots and gloves (armour 13; expects 44%).
- Every match ended in a death; the loser respawned in the Ring at full HP.
  Nothing was one-shot.
- The mirrored setup is **deterministic**: the same login order reproduces the
  same roll sequence, so the eight matches are four repeats of two distinct
  outcomes per level, not eight independent trials. The sample therefore
  cannot estimate a win rate. The winner was not the side that landed the
  first blow: pvp-a landed first in every match and split 4/4 at both levels.
- The observed hit rates are inside the small-sample range of `57 - armour`
  (40.0% vs 50%, 41.7% vs 44%). Average damage matches `1..4 + weapon`
  (6.5 vs 5.5, 11.4 vs 10.5).
- The first pass was **two live clients, not two LLM agents**.

### Two remote model agents (v0.91.33)

`tools/pvp-agents.mjs` starts two `runtime/agent.mjs` processes on an isolated
server. Both use OpenCode/DeepSeek and the real Ring flow: take/wield/wear the
mirrored kit, challenge, accept, attack. `AGENT_SCENARIO=pvp` replaces the
default Vault route and a stay-in-the-Ring guard prevents wandering.

| Level | Winner | Rounds | Attacks | Winner hits/damage | Loser hits/damage | Winner HP | Agent turns A/B |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | pvp-a | 8 | 16 | 6 / 46 | 2 / 12 | 28 / 40 | 26 / 24 |
| 10 | pvp-a | 12 | 24 | 6 / 68 | 4 / 48 | 11 / 65 | 36 / 33 |

Both agents took their own kits, wielded/wore them, and completed challenge →
accept → attack. The challenger used Power Strike at level 5 and Cleave at
level 10; the defender did not use a technique. This is a **model-behaviour
sample, not a balance sample**: the two models did not make equivalent choices.
The level-10 first attempt was discarded: one agent wandered and hit its turn
cap before the duel ended. The stay-in-the-Ring guard and a 60-turn budget made
the rerun complete.

### Asymmetric dawn vs ember (v0.91.33)

`node tools/pvp-session.mjs --level=10 --matches=8 --matchup=dawn-ember` runs
the scripted live duel with the two kits already in the deterministic sampler:

| Matches | Distinct outcomes | Attacks | Hits | Hit rate | Avg damage | Rounds | Winner | Winner HP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 2 | 200 | 84 | **42.0%** | **10.48** | **12.5** | dawn/pvp-a 8/8 | 11 / 65 avg (3 and 19) |

The dawn kit (8-damage blade, armour 13) beat the ember kit (6-damage brand with
burn, armour 12) in both distinct outcomes, but the close outcome finished at
**3/65 HP**. The setup is deterministic, so 8/8 is not eight independent wins.
The existing deterministic sampler's 47% for this matchup is not contradicted by
two close outcomes; the live sample says the matchup warrants a larger,
independent pass, not a damage change.

### Independent random-tick samples (v0.91.33 baseline)

`tools/pvp-session.mjs --random-tick=1` starts each fresh world at a random
world tick, so the combat rolls are independent. Both orientations of the
dawn/ember matchup are run: in the normal orientation dawn is pvp-a; in the
swapped orientation dawn is pvp-b.

| Matchup | Matches | Attacks | Hits | Hit rate (95% CI) | Avg damage | Exchange rounds | Wins | Winner HP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L5 mirror | 29 | 728 | 352 | **48.35%** (44.7–52.0) | **5.58** | **12.55** | B 19 / A 10 (65.5%, 47.3–80.1) | 13.8 / 40 |
| L10 mirror | 20 | 490 | 209 | **42.65%** (38.3–47.1) | **10.44** | **12.25** | A 12 / B 8 (60%, 38.7–78.1) | 11.1 / 65 |
| L10 dawn/ember baseline | 41 | 978 | 426 | **43.56%** (40.4–46.8) | **9.76** | **11.93** | dawn 30 / ember 11 (73.2%, 58.1–84.3) | 18.9 / 65 |

- The dawn/ember baseline is 15/20 in the normal orientation and 15/21 in the
  swapped orientation; the kit effect is not just the A/B side.
- The hit rates match `57 - armour` (50% at L5, 44% at L10), and average
  damage matches `1..4 + weapon` (5.5 and 10.5) within the sample.
- The L5 mirror leans to pvp-b and the L10 mirror leans to pvp-a, but both
  intervals include 50%; watch-list only.
- No one-shot: the winner retained 17–34% of max HP on average.

### Candidate v0.91.34 adjustment and confirmation

The first data-driven PvP change is a small Red Company buff: **ember brand
damage 6 → 7** and **Red Company helm armour 2 → 3**. The ember sample kit now
uses the Red Company helm instead of the generic iron helmet.

| Sample | Matches | Attacks | Hits | Hit rate | Avg damage | Rounds | Dawn wins | Winner HP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 41 | 978 | 426 | 43.56% | 9.76 | 11.93 | 30 (73.2%, 58.1–84.3) | 18.9 / 65 |
| Candidate | 40 | 926 | 409 | **44.17%** | **10.21** | **11.57** | **25 (62.5%, 47.0–75.8)** | 17.4 / 65 |
| Confirmed | 60 | 1,422 | 623 | **43.81%** | **10.11** | **11.85** | **37 (61.7%, 49.0–72.9)** | 16.7 / 65 |

The confirmation adds 20 matches (original 17/30, swapped 20/30). The point
estimate stays at 61.7%, the confidence interval includes 50%, and the
hit/damage curve is unchanged. The adjustment is kept; no further value
changed. It remains a watch item until a larger independent or human sample.

### Fixed-damage PvP model (v0.91.35 correction)

The live server resolves violence every 12 ticks. `attackRoll` derives damage
from `tick * 7 mod 4`, and 12 × 7 is divisible by 4, so **each attacker's damage
is constant for the whole duel**. The hit roll uses `tick * 13 mod 100`, and
12 × 13 = 156 is not divisible by 100, so hit/miss still varies every round.
Combat has no `Math.random`: it is a deterministic LCG seeded by the tick and
actor id, which is what makes replay and acceptance vectors possible.

Across the 141 independent dawn/ember matches, all 282 side-fights had exactly
one damage value, and every side had both hits and misses (per-side hit rates
25–75%, mean 44.1%). The side with the higher fixed damage won 89 of 107
decisive matches (83.2%); the L5 mirror's higher-damage side won 25/29 and the
L10 mirror's 16/20. That is the live mechanic, not a confound: it amplifies the
gear gap instead of averaging it away.

`tools/pvp-model.mjs` samples every start-tick phase, both actor-id assignments
and both kit orientations with the real `attackRoll`:

| Scenario | Dawn win | Ember win |
| --- | --- | --- |
| Level 5 mirror | 50.0% | 50.0% |
| Level 10 mirror | 50.0% | 50.0% |
| Dawn/ember baseline (ember 6 / helm 2) | **72.9%** | 27.1% |
| Dawn/ember v0.91.34 (ember 7 / helm 3) | **61.3%** | 38.7% |
| Dawn/ember v0.91.36 (ember 8 / helm 3) | **50.0%** | 50.0% |
| Dawn/ember next (ember 9 / helm 3) | 39.3% | **60.7%** |

The model reproduces the live baseline (73.2%) and candidate (62.5%) within a
point, so the v0.91.34 evidence is valid. It also explains why the
`tools/balance.mjs` PvP band reports 46.25%: that sampler increments the tick
every round, giving damage variance the live server does not have. The live
fixed-damage model is the reference for PvP gear; the deterministic band stays
useful for the PvE bands and the Gate's broad 25–75% guard.

### v0.91.36 paired live confirmation

The ember-8 candidate was sampled live in a paired design: 7 fixed start ticks
× 2 login orders × 2 kit orientations = 28 unique pairs. Because only ember
damage changes, the hit rolls are identical within a pair and the comparison is
an exact counterfactual.

| Arm | Dawn wins | Dawn share |
| --- | --- | --- |
| v0.91.34 current (ember 7 / helm 3) | 16 / 28 | 57.1% |
| v0.91.36 candidate (ember 8 / helm 3) | 14 / 28 | **50.0%** |

Two pairs flipped from dawn to ember and none flipped back. The win-flip
McNemar p is 0.50, so the win count alone is not significant at this sample
size. The paired finishing margin is much more sensitive: dawn-minus-ember HP
improved for ember in 22/28 pairs, was unchanged in 6, and worsened in 0; the
mean change is **-5.14 HP** (95% CI -7.42 to -2.86; sign-test p < 0.0001). The
candidate also matches the fixed-damage model's 50.0% prediction.

**v0.91.36 ships ember brand damage 8.** A further +1 (9 / 3) models at 39.3%
dawn, which would overcorrect; no further value changed. `tools/pvp-session.mjs`
accepts `--ticks`, `--world` and `--label` for future paired runs.

## Decision

No balance value changes before v0.91.34. **v0.91.34 makes the first
data-driven PvP adjustment:** ember brand 6 → 7 and Red Company helm 2 → 3.

- Historical: the 64.3% remote hit rate is within sampling noise of the
  `57 - armour` curve; average damage 4.67 matches `1..4 + 3`; the wraith
  fights ended in kills with no player deaths.
- The live mirror duels are close and consistent with the armour/damage curve.
- The two-agent sample proves the model-facing PvP path but is a behaviour
  sample, not a balance sample.
- The independent dawn/ember baseline was 30/41 (73.2%, CI 58.1–84.3) with
  dawn winning in both orientations. The v0.91.34 candidate is 25/40 (62.5%,
  CI 47.0–75.8), and the 60-match confirmation is 37/60 (61.7%, CI 49.0–72.9),
  with hit rate 43.81% and average damage 10.11. The adjustment is kept; it is
  modest and moves the matchup toward even, but does not prove balance.
- The L5 pvp-b 19/29 (65.5%, CI 47.3–80.1) and L10 pvp-a 12/20 (60%, CI
  38.7–78.1) remain watch items; no change.
- No other damage, armour, food or level values changed. The deterministic
  PvP band for dawn/ember is 42.75% at 400 seeds, inside the Gate's 25–75%;
  it is a different tick model from live and is not used as the PvP gear
  reference.
- The fixed-damage model puts the baseline at 72.9%, v0.91.34 at 61.3%, and
  v0.91.36 at 50.0%, matching the live 73.2%, 62.5% and 50.0% samples. The
  v0.91.36 paired sample improved ember's margin in 22/28 pairs without a
  single regression. **v0.91.36 is the second data-driven PvP adjustment:**
  ember brand 7 → 8.
- No further PvP value changes. Ember 9 / helm 3 models at 39.3% dawn, so it
  would overcorrect. A larger human/model sample remains the next check; if
  the L5 pvp-b lean persists, inspect initiative/connection order.

### Live early PvE sample (v0.91.46)

`tools/pve-session.mjs` starts a fresh isolated server per match, pins the
enemy, puts a level-1 character in the free practice gear, and attacks with a
random world tick. The current pacing makes the boar 14 HP / 3 damage.

| Enemy | Matches | Player wins | Average rounds | Average player HP |
| --- | ---: | ---: | ---: | ---: |
| wild boar | 20 | 20 (100%) | 7.3 | 13.05 / 20 |
| grey wolf | 20 | 20 (100%) | 9.3 | 11.8 / 20 |

The deterministic unarmed novice/boar band is 58.5%, so the first boar is a
real risk only if the player skips the Training Yard. With the free practice
sword and shield it is safe; the wolf costs about one more round and 1.3 more
HP. **No balance change**: the first-hour gear and `consider` read are enough,
and a human/asymmetric sample remains the next check.

The deterministic bands remain the reference:

```
early     67–77% win
mid       84–100%
high      86–97%
capstone  62–100%
```

What would change the conclusion: an asymmetric or model-driven PvP sample,
a complete unseeded level-10 session, or repeated player deaths against the
same mobile. The next tuning pass should collect those before touching damage,
armour, food/ale healing or the level curve.
