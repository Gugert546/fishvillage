# Progression sim — town level 1 → 10

**Run it:** `node scripts/sim/sim.ts` (Node 23+, no build step; about 1 min for both profiles at 20
runs each). Options:
- `--profile grinder|daily` runs one profile only.
- `--seeds N` sets the number of runs.
- `--gates` adds a column with what each level waited on.
- `--log` prints a purchase log of run 1; `--trace` adds a line per minute to it.
- `--rates` prints fishing $/min by gear.
- `--set PATH=VALUE` changes a number without editing src, e.g. `--set TOWN_LEVELS.7.cost=100000`
  or `--set OFFLINE_RATE=0.75`.
- `--fn 'PATH=EXPR'` replaces a function, e.g.
  `--fn 'BUILDING_BY_ID.fishStand.incomePerWorker=(l)=>6*1.3**(l-1)'`.
- `--set A.name=VALUE` changes a player assumption, e.g. `--set A.catchChance=0.35`.

The sim imports the live numbers from `src/config.ts` and re-models the rules in simplified form.
It's for comparing levels and testing changes, not for exact minutes. Simulated on v0.0.7 config,
2026-10-16.

## Goal v2: passive income from level 5

**Goal:**
- **Levels 1–5:** fishing-led and done in the first one or two sessions, each level a bit longer than the last.
- **Levels 6–10:** about one day per level for a daily player, growing a bit (2–3 days for level 10).
  Offline town income should bring in most of their coins.
- **A grinder** who fishes non-stop gets through faster, but at several hours of fishing per level
  late on. It shouldn't be a shortcut that makes passive income pointless.

**Profiles:**
- **Daily player:** two 20 min sessions a day. After the first they're away 8 h overnight, after the
  second 15.3 h through the day. Each gap is paid like `economy.ts` pays a long absence:
  - town income after wages × `OFFLINE_RATE`, up to the offline cap (`OFFLINE_CAP_HOURS` + Warehouse
    workers' hours);
  - wharf and trade-ship income in full (`tickTrade` gets the capped time but isn't halved);
  - move-ins on the capped time;
  - no festival (it ends long before you're back).
- **Grinder:** never away; the same player model as below.

Both plan purchases by payback. The daily player also counts what a building earns while they're
away, so they build up the town. "Coins" shares are all coins earned during that level. "Town on
arrival" is gross town income ($/min) when the level is reached, with wages as a share of it in
brackets.

The daily player's times come in steps of whole sessions: they level up when they come back and
collect. "24 h" means the same session on the next day.

### Current config

| Level | Grinder: time in level | Grinder coins: fishing / town | Daily: reached at | Daily: time in level | Daily coins: fishing / town (playing) / offline |
|---|---|---|---|---|---|
| 1 → 2 | 11 min | 97% / 3% | 13 min | 13 min | 92% / 8% / 0% |
| 2 → 3 | 7 min | 92% / 8% | 20 min | 7 min | 68% / 9% / 22% |
| 3 → 4 | 4 min | 92% / 8% | 8.4 h | 8.0 h | 40% / 6% / 54% |
| 4 → 5 | 11 min | 93% / 7% | 24 h | 16 h | 25% / 5% / 70% |
| 5 → 6 | 22 min | 95% / 5% | 24 h | 13 min | 84% / 16% / 0% |
| 6 → 7 | 40 min | 96% / 4% | 32 h | 8 h | 22% / 5% / 73% |
| 7 → 8 | 26 min | 98% / 2% | 2.0 d | 16 h | 50% / 4% / 46% |
| 8 → 9 | 60 min | 98% / 2% | 3.3 d | 32 h | 47% / 3% / 49% |
| 9 → 10 | 2.5 h | 97% / 3% | 5.3 d | 2.0 d | 48% / 4% / 48% |

- The grinder reaches level 10 in **5.6 h** of play and the daily player in **5.3 days**: the grinder is
  about 20× faster in real time. Town income is 2–5% of the grinder's coins, so for them it really is
  pointless.
- The daily player already gets about half their late-game coins offline. But levels 6–8 take only
  hours, and fishing still matches offline income because boat fish are so valuable.
- Wages are small: 6–17% of town income, never a problem.

### Proposed config

**Grinder** (never away, median of 20 runs):

| Level | Time in level | × previous | Total play | Coins: fishing / town | Town on arrival (wages) |
|---|---|---|---|---|---|
| 1 → 2 | 11 min | — | 11 min | 97% / 3% | $6/min (11%) |
| 2 → 3 | 10 min | 0.91 | 21 min | 80% / 20% | $15/min (7%) |
| 3 → 4 | 10 min | 1.01 | 30 min | 79% / 21% | $40/min (5%) |
| 4 → 5 | 12 min | 1.25 | 43 min | 80% / 20% | $60/min (6%) |
| 5 → 6 | 1.7 h | — | 2.4 h | 79% / 21% | $1,516/min (5%) |
| 6 → 7 | 2.7 h | 1.66 | 5.2 h | 69% / 31% | $2,308/min (4%) |
| 7 → 8 | 3.0 h | 1.09 | 8.2 h | 82% / 18% | $2,728/min (4%) |
| 8 → 9 | 5.0 h | 1.66 | 13.1 h | 82% / 18% | $3,398/min (4%) |
| 9 → 10 | 7.6 h | 1.54 | 21.0 h | 80% / 20% | $3,941/min (4%) |

**Daily player** (2 × 20 min a day, median of 20 runs):

| Level | Reached at | Time in level | Play in level | Coins: fishing / town (playing) / offline | Town on arrival (wages) |
|---|---|---|---|---|---|
| 1 → 2 | 13 min (session 1) | 13 min | 13 min | 89% / 11% / 0% | $22/min (11%) |
| 2 → 3 | 8.3 h (session 2) | 8.1 h | 7 min | 10% / 5% / 85% | $49/min (9%) |
| 3 → 4 | 8.4 h (session 2) | 2 min | 2 min | 30% / 70% / 0% | $159/min (9%) |
| 4 → 5 | 8.6 h (session 2) | 13 min | 13 min | 60% / 40% / 0% | $360/min (7%) |
| 5 → 6 | 1.4 d | 1.0 d | 44 min | 15% / 7% / **78%** | $1,785/min (4%) |
| 6 → 7 | 3.0 d | 1.0 d | 41 min | 8% / 5% / **88%** | $3,821/min (4%) |
| 7 → 8 | 3.4 d | 1.0 d | 33 min | 20% / 5% / **75%** | $3,979/min (4%) |
| 8 → 9 | 5.3 d | 2.0 d | 72 min | 18% / 5% / **77%** | $4,871/min (3%) |
| 9 → 10 | 8.0 d | 3.0 d | 1.8 h | 18% / 5% / **77%** | $5,138/min (3%) |

("Reached at" is the median of each run's own time, so it doesn't add up exactly from the
"Time in level" medians.)

**How it meets the goal:**
- **Levels 1–5** take 43 min of fishing for the grinder (10–12 min each, about 80% of coins from
  fishing). The daily player is at level 5 in their second session.
- **Levels 6–10** take the daily player 1 / 1 / 1 / 2 / 3 days (8 days in all, about 5 h of play).
  75–88% of their coins in those levels come in offline.
- **The grinder** still gets there in **21 h** of play, at 1.7 → 7.6 h per level. Town income gives them
  18–31% of their coins, so building the town still pays even for them.
- **Wages** stay at 3–11% of town income.
- **Breaks:**
  - For the grinder, 2 → 3 is a little shorter than 1 → 2 (×0.91).
  - For the daily player, the first night already brings in 85% of the coins for 2 → 3 (small town,
    but 8 h of it).

**Changes** (all in `src/config.ts` except 7):

1. **Slower early gear** (kept from v1): `UPGRADES` Longer Line and Bigger Hook `levelsPerShopLevel: 4 → 2`.
   Leave the Tackle Shop at `maxLevel: 5`, so the line tops out at 190 m. That keeps late fishing flat
   (drop v1 suggestion 2).
2. **Boats one level before their fish** (kept from v1): `AREAS` Coral Reef `unlockLevel: 5 → 7`,
   Deep Trench `6 → 8`, Arctic Waters `6 → 9`.
3. **Early house a bit cheaper**, so level 5 fits in two sessions: `TOWN_LEVELS[4].cost: 6_000 → 4_000`,
   `TOWN_LEVELS[5].cost: 20_000 → 10_000`, `TOWN_LEVELS[5].residents: 24 → 20`.
4. **Late house costs sized to a day of town income:** `TOWN_LEVELS` costs for levels 6–10:

   | Level | Now | Proposed |
   |---|---|---|
   | 6 | 60_000 | 350_000 |
   | 7 | 150_000 | 1_100_000 |
   | 8 | 400_000 | 2_700_000 |
   | 9 | 1_000_000 | 5_500_000 |
   | 10 | 2_500_000 | 9_000_000 |

   Fish and resident requirements stay as they are. Once you own the boat, its 3–8 fish take one or
   two casts with the right bait, so the boat's price is the real gate.
5. **Workplace income grows with level** so the town outgrows fishing after level 5 (it's
   `1.15^(level−1)` today):

   | Building | Now | Proposed |
   |---|---|---|
   | Fish Stand `incomePerWorker` | `6 × 1.15^(l−1)` | `6 × 1.3^(l−1)` (Lv 10: $64/min a worker instead of $21) |
   | Fisherman's Hut `incomePerWorker` | `9 × 1.15^(l−1)` | `9 × 1.3^(l−1)` |
   | Seafood Restaurant `incomePerWorker` | `20 × 1.15^(l−1)` | `25 × 1.3^(l−1)` |

   Wages only grow 15% per level, so they don't catch up.
6. **A night counts:** `OFFLINE_CAP_HOURS: 4 → 8`, `OFFLINE_RATE` stays `0.5`. In the sim this matters
   less than expected (8 days vs 9 with the cap at 4 h), because the daily player staffs a Warehouse
   early (+3 to +6 h). It matters most for a new player at levels 3–5, before the Warehouse.
7. **Festival cost counts fishing too** (code change in `festival.ts`, not config): `festivalCost()`
   should use 10 min of town income *plus* recent fishing income. Today it's town income only, so a
   grinder keeps a +15% fish-price festival running for pocket change. A cooldown would also work.
   The sim models this with `A.festivalCountsFishing=1`.

Optional:
- Boat-area fish values ×0.6 make the grinder slower (25 h instead of 21 h) and barely change the
  daily player. Not needed for the goal, but it's the lever if the grinder still feels too fast.
- Without change 5 (everything else kept), the daily player needs 10.4 days and the grinder 23 h.
  Lower level costs would make up the difference, but then town income falls to about 11% of the
  grinder's late coins, and offline to about 70% of the daily player's.

**Reproduce** (bash; in zsh too, since nothing goes through a variable):

```bash
node scripts/sim/sim.ts --set UPGRADES.0.levelsPerShopLevel=2 --set UPGRADES.1.levelsPerShopLevel=2 --set AREAS.2.unlockLevel=7 --set AREAS.3.unlockLevel=8 --set AREAS.4.unlockLevel=9 --set OFFLINE_CAP_HOURS=8 --set A.festivalCountsFishing=1 --set TOWN_LEVELS.4.cost=4000 --set TOWN_LEVELS.5.cost=10000 --set TOWN_LEVELS.5.residents=20 --set TOWN_LEVELS.6.cost=350000 --set TOWN_LEVELS.7.cost=1100000 --set TOWN_LEVELS.8.cost=2700000 --set TOWN_LEVELS.9.cost=5500000 --set TOWN_LEVELS.10.cost=9000000 --fn 'BUILDING_BY_ID.fishStand.incomePerWorker=(l)=>6*1.3**(l-1)' --fn 'BUILDING_BY_ID.fishermansHut.incomePerWorker=(l)=>9*1.3**(l-1)' --fn 'BUILDING_BY_ID.seafoodRestaurant.incomePerWorker=(l)=>25*1.3**(l-1)'
```

**Assumptions for v2** (on top of the player model at the bottom):
- **Both away gaps are paid, each up to the cap:** with the Warehouse that's most of the day gap too.
  A player who only leaves the game overnight would earn less offline. Change `A.awayHours` and
  `A.sessionMin` to try other schedules.
- **The daily player doesn't fish more on the first day.** A first session is probably longer in
  practice, which only makes levels 1–5 easier.
- **The daily player plans by payback over their whole day,** so they invest in the town from level 3
  on. That's why offline income is already large at levels 2–5.
- **Not modelled:** the Railway Station, Long Nap perk, festivals timed to end at logout, the merchant
  and town projects. The festival and Railway would make the daily player a bit faster.
- **Sim fixes since v1:** the player now saves fish for the Tackle Shop upgrade the house's fish
  depends on, buys a forced longer line first, keeps cash for land, and pays for bait. A v1-style
  grinder run on today's config gives practically the same numbers as below.

---

# Goal v1: each level a bit longer (earlier results)

**Pacing goal:** each town level takes a bit longer than the one before (about ×1.2–1.5).

## Result: current config (median of 20 runs, skilled active player)

| Level | Reached at | Time in level | × previous | Income on arrival | Fishing share | What it waited on |
|---|---|---|---|---|---|---|
| 1 → 2 | 11 min | 11 min | — | $266/min | 80% | coins 63%, residents 37% |
| 2 → 3 | 18 min | **7 min** | 0.64 ✗ | $1,655/min | 93% | coins 51%, residents 49% |
| 3 → 4 | 24 min | **5 min** | 0.69 ✗ | $1,798/min | 92% | coins 66%, fish 19%, residents 15% |
| 4 → 5 | 35 min | 12 min | 2.43 ✗ | $3,433/min | 93% | coins 76%, residents 20%, fish 4% |
| 5 → 6 | 54 min | 19 min | 1.52 | $5,112/min | 94% | coins 78%, residents 12%, fish 10% |
| 6 → 7 | 1.5 h | 38 min | 2.07 ✗ | $19,863/min | 98% | coins 77%, fish 19%, residents 4% |
| 7 → 8 | 1.9 h | **21 min** | 0.56 ✗ | $21,393/min | 98% | coins 84%, fish 10%, residents 6% |
| 8 → 9 | 2.9 h | 62 min | 2.89 ✗ | $22,664/min | 97% | coins 79%, fish 19%, residents 2% |
| 9 → 10 | 5.6 h | 2.6 h | 2.56 ✗ | $25,264/min | 95% | coins 77%, fish 22%, residents 1% |

"Income on arrival" is coins per minute (fishing + town − wages − festivals − bait) right after the
level-up. "What it waited on" is the share of time each requirement was still missing; several can be
missing at once.

A slower player (catches 35% of fish passed instead of 50%, 12 s instead of 8 s between casts, loses most
legendary fights, gets hooked more often on the way down) takes **7.1 h** in all and shows the same
shape: 18 / 11 / 16 / 18 / 31 / 55 / **35** / 75 / 168 min.

### Where the curve breaks the goal

1. **Levels 2 → 4 go too fast (7 and 5 min after 11 min for level 2).** Cheap gear is the cause. Longer
   Line and Bigger Hook start at $20–$25 with ×1.55–1.6 growth, and the Tackle Shop allows 4 levels per
   shop level. A Lv 2 shop ($300) lets the line reach 160 m at town level 2. Fishing income goes from
   about $36/min to about $900/min in roughly 15 minutes of play (see `--rates` below), while the house
   costs only go $300 → $1,500 → $6,000. This matches the first note in PLAYTEST.md.
2. **4 → 5 jumps ×2.4, then 6 → 7 jumps ×2.1.** Two big income steps: the line passes 150 m (Anglerfish
   and Old Barnacle, see below), then the Open Sea boat at level 6. Between them income barely moves while
   costs ×3.
3. **7 → 8 gets shorter (21 min after 38).** The Catamaran (Lv 5 unlock, $90k) gets bought during level 6
   as an investment. That makes the Lv 7 income big, and Lv 8's Grouper lives in the reef you already
   have. The boats unlock two or three town levels before the level that needs their fish.
4. **8 → 9 and 9 → 10 jump ×2.9 and ×2.6.** After level 7 income flattens (about $20–25k/min). Gear tops
   out at Tackle Shop Lv 5 (line 280 m), and the Trawler and Icebreaker add little over the reef. But
   costs keep going ×2.5 ($400k → $1M → $2.5M) on top of the $300k and $1M boats.

### Other findings

- **Fishing is 80–98% of all income at every level.** Town workplaces pay $6–20/min per worker
  against $1k–25k/min from fishing, so the sim almost never builds shops for money. It only builds
  homes for the resident requirements and the Tackle/Bait Shop, Fish Market and Net Maker (fishing
  boosts). The design's "build → passive income" loop doesn't pull its weight. This isn't a pacing
  break, but it explains why every level is "coins from fishing" vs house cost.
- **Festivals have no cooldown and cost 10 min of *town* income** (min $150). Fishing doesn't count
  towards the cost, so a festival always running costs about $15–100/min for +15% fish price, +15
  happiness and ×2 move-ins. The sim keeps one going from level 2.
- **Old Barnacle** ($1,500, 25% of casts once the line reaches 150 m) is about a quarter of Harbor
  income at a 160 m line, even if only 35% of the fights are won. A 160 m line is possible at town
  level 2 today.
- **Residents gate the early game:** at 20 s per move-in, residents are 26–49% of the wait for levels
  2–3. From level 6 on they hardly matter (homes are cheap compared with income).
- **Fish requirements gate the late game:** about 20–25% of the wait at levels 6 → 10, mostly spent
  catching the 3–8 boat fish. That feels right.
- In the model, more Bigger Hook levels can *lower* $/min once the hook outgrows the valuable deep
  fish: it fills with cheap shallow fish, so it reaches the 4× full-hook reel later. Worth a look
  in the real game.

Fishing $/min in the Harbor by gear (town level 1 prices, no bait, skilled player; `--rates`):

| Line | Hook | Reel | $/min | from Old Barnacle |
|---|---|---|---|---|
| 40 m | 3 | 7.0 m/s | 36 | 0% |
| 70 m | 4 | 8.2 m/s | 93 | 0% |
| 100 m | 7 | 9.4 m/s | 202 | 0% |
| 130 m | 7 | 11.8 m/s | 392 | 0% |
| 160 m | 9 | 11.8 m/s | 903 | 24% |
| 220 m | 13 | 16.6 m/s | 1,814 | 5% |
| 280 m | 15 | 19.0 m/s | 3,538 | 1% |

## Tuning suggestions

Tested together in the sim. Result is in the table below.

1. **Slow the early gear:** `UPGRADES` Longer Line and Bigger Hook `levelsPerShopLevel: 4 → 2`
   (the PLAYTEST.md note). On its own this fixes levels 1 → 6: 11 / 11 / 12 / 15 / 22 min.
2. **Let the Tackle Shop keep growing:** Tackle Shop `maxLevel: 5 → 8`. With 2 levels per shop
   level the line would otherwise stop at 190 m. Shop Lv 6–8 cost $29k / $73k / $183k plus 20–28 Cod
   with the current formulas, so they become a late-game sink.
3. **Unlock each boat one level before its fish is needed:** `AREAS` Coral Reef `unlockLevel: 5 → 7`,
   Deep Trench `6 → 8`, Arctic Waters `6 → 9` (Open Sea stays at 5). This removes the 7 → 8 dip, and
   every late level then means "buy the boat, catch its fish, pay the house".
4. **Flatten the late-game costs:** `TOWN_LEVELS` Lv 7 cost `150_000 → 100_000`, Lv 9
   `1_000_000 → 800_000`, Lv 10 `2_500_000 → 1_300_000`. Also Arctic Waters `cost: 1_000_000 → 600_000`.
   Income stops growing after level 7, so costs can't keep going ×2.5.
5. **Small bump at level 3:** `TOWN_LEVELS` Lv 3 cost `1_500 → 2_000`, so 2 → 3 isn't shorter than 1 → 2.
6. *(Not pacing, but related)* Base the festival cost on fishing too (e.g. on the last 10 min of total
   earnings), or give festivals a cooldown. Also consider raising workplace income, or tying it to
   fishing (Fish Stands selling a share of your catch?), if the town is meant to matter for money.

With 1–5 applied (median of 20 runs, `node scripts/sim/sim.ts` plus the `--set`s below):

| Level | Time in level | × previous | Reached at |
|---|---|---|---|
| 1 → 2 | 11 min | — | 11 min |
| 2 → 3 | 12 min | 1.10 | 22 min |
| 3 → 4 | 12 min | 1.01 | 34 min |
| 4 → 5 | 14 min | 1.18 | 48 min |
| 5 → 6 | 23 min | 1.60 | 71 min |
| 6 → 7 | 33 min | 1.46 | 1.7 h |
| 7 → 8 | 48 min | 1.44 | 2.5 h |
| 8 → 9 | 66 min | 1.40 | 3.6 h |
| 9 → 10 | 1.7 h | 1.57 | 5.4 h |

Every level now takes as long as or longer than the one before. The slower player gets
17 / 18 / 18 / 23 / 39 / 58 / 88 / 120 / 174 min (9.2 h in all), also never shorter. If 2 → 4 should
grow more clearly, raise Lv 4 to about $8,000 next.

```bash
B="--set UPGRADES.0.levelsPerShopLevel=2 --set UPGRADES.1.levelsPerShopLevel=2 --set BUILDINGS.5.maxLevel=8 --set AREAS.2.unlockLevel=7 --set AREAS.3.unlockLevel=8 --set AREAS.4.unlockLevel=9 --set TOWN_LEVELS.3.cost=2000 --set TOWN_LEVELS.7.cost=100000 --set TOWN_LEVELS.9.cost=800000 --set TOWN_LEVELS.10.cost=1300000 --set AREAS.4.cost=600000"; node scripts/sim/sim.ts ${=B}
```

(`BUILDINGS.5` is the Tackle Shop, `AREAS.2/3/4` are Reef / Trench / Arctic. Indices follow the order
in config.ts.)

## The player model (assumptions)

- **Active play only:** fishing non-stop, with town income ticking along. No offline time, so
  Warehouses and the offline cap aren't modelled. No weather, night or daily quest. Daily prices are
  averaged at ×1.1.
- **A cast** (Monte Carlo, per area): fish spawn like `spawnFish` (area density × bait, species weights
  in each depth range). On the way down each fish has a 1.2% chance to be undodgeable (it gets hooked
  and the hook turns back); Lucky Lure and the Harpoon absorb hits. Sharks and ice stop the line now
  and then. On the way up the player catches 50% of the fish they pass, deepest first, until the hook
  is full, then reels at 4× speed. Old Barnacle and the other legendaries show up in 25% of casts
  (when the line reaches them) and are landed 35% of the time (6 s fights). Chests come when the line
  reaches the floor. Repeats pay combo bonuses. 8 s between casts. The Reef, Trench and Arctic have a
  10–15% efficiency penalty for their hazards.
- **Prices:** house level +10% per level, Fish Market workers, festival +15%, Fisher Statue.
- **Town:** each home has a road and its residents have jobs (50% happiness), plus decorations by town
  level: +8 at Lv 1 up to +25 at Lv 7+ (about 58–75% happiness), $25 × town level of decor per new home.
  Workplaces are staffed by best value, with the real wage formula. A market street (+10%) and road
  bonus (+10%) apply to every shop. Tourism, the Fillet House, Water Mills (each reaches half the town),
  orders (+5% per delivery, one every 10 min) and the wharf → cannery → export chain are simplified.
  Quests (one every 4 min, average reward of the kinds), resident requests (half done) and orders
  (half delivered) count as a steady trickle from level 2/3.
- **Buying:** every cast the player looks at all fishing upgrades (with the shop upgrade they need), rods,
  boats, new and upgraded workplaces (with homes for their workers), the Town Square, and homes. They
  buy the best payback if it pays for itself before the house upgrade would be affordable anyway (or
  within 5 min). Homes for the next level's resident requirement are bought as soon as the money is
  there. So is a boat whose fish the next level needs. Cod, Salmon, Tuna and Anglerfish are kept for
  upgrades (not sold), plus the house's fish. Land expansions are bought when the grid fills (each
  building takes 1.5× its footprint for roads and decor).
- **Not modelled:** the merchant, town projects, perks, arrangement discovery rewards, the Lighthouse,
  Icehouse capacity (barrels never fill up), sell timing, and how long a human takes to build things.

No sanity check was run in the real game. The dev server's save lives in the browser's
localStorage, and testing the real economy means switching Free mode off and playing from a
fresh save, which could clash with the live playtest. The user's real times in PLAYTEST.md are the
best way to calibrate the sim. Compare them with the slower-player numbers, and adjust
`A.catchChance` / `A.castOverhead` in `scripts/sim/sim.ts` until levels 1–3 match.
