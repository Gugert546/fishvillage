# Playtest notes

Feedback from playtesting, collected for the next rebalance pass. Each note has what was seen and, where useful, the numbers involved now.

**Pacing goal:** each town level should take a bit longer to get through than the one before.
- **Levels 1–5:** fishing is the main income, and the levels can be reached in the first sessions.
- **Level 6 on:** the goalposts move. Progress mostly comes from the town's passive income overnight, so players come back each day. Lots of fishing should still work as an alternative, just more slowly.

A simulated run from a fresh start is in [PLAYTEST-SIM.md](PLAYTEST-SIM.md).

## 2026-10-16 — fresh start, v0.0.7

1. **Tackle Shop Lv 1 gives too many upgrades.** ✅ *done* Longer Line and Bigger Hook should each allow one or two fewer levels at shop level 1.
   - Now: both have `levelsPerShopLevel: 4` ([config.ts](src/config.ts), `UPGRADES`), so a Lv 1 shop sells Line up to +60 m and Hook up to +4 fish.
   - Idea: 2–3 levels at shop Lv 1. Either lower `levelsPerShopLevel`, or add a smaller first step so later shop levels keep their pace.
2. **Bug: the Barrels button doesn't update after selling.** ✅ *done* It keeps showing the old count until you go to town and back.
   - Cause: closing the market calls `refreshHud()` ([FishingScene.ts:493](src/scenes/FishingScene.ts:493)), but the `Barrels n/m` label is only set in `refreshAreaButton()` ([FishingScene.ts:559](src/scenes/FishingScene.ts:559)).
   - Fix: call `refreshAreaButton()` too when the market closes (one line).
3. **Buildings need unique names.** ✅ *done* With several of the same kind it gets confusing which is which.
   - Now: the residents list and job picker say "Fish Stand #2" (`buildingLabel`, [TownScene.ts:1425](src/scenes/TownScene.ts:1425)), numbered by build order, so numbers shift when one is sold. The building's own panel just says "Fish Stand", and nothing on the map tells them apart.
   - Ideas: give each building a stored name when placed (e.g. "Harbour Fish Stand", "Ada's Cottage", or a street-style name), show it in its panel title and everywhere `buildingLabel` is used, and maybe allow renaming.
4. **The residents list needs sorting:** ✅ *done* by job, happiness, name and home.
   - Now: always sorted by name (`openResidents`, [TownScene.ts](src/scenes/TownScene.ts)).
   - Idea: a row of sort buttons under the title (Name / Job / Mood / Home), remembered between visits. Works best together with note 3, so "by home" and "by job" group under clear names.
5. **Barrels should show which fish are needed,** ✅ *done* so players don't sell fish a building needs.
   - Now: the Barrels list ([ui.ts](src/ui.ts), `openMarket`) shows name, count and price only, and "Sell all" sells everything. Fish are needed for building upgrades (`upgradeNeed`, [crates.ts:70](src/crates.ts:70)), house levels (`TOWN_LEVELS` fish, e.g. 10 Salmon for Lv 4) and open orders.
   - Idea: a tag on each row ("House needs 10", "Tackle Shop needs 6", "Order"), and "Sell all" keeps what's needed (with a way to sell it anyway).
