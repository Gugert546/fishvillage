# Fish Village — Design

Fish from a little dock, sell the catch, and grow a village that earns passive income and unlocks better gear.

**Core loop:** fish → sell → build → passive income + upgrades → fish deeper → build more.

## Platform & tech

- TypeScript + Phaser 4 + Vite, portrait, runs in the browser.
- Test on iPhone via Safari over Wi-Fi (`npm run dev`, open the Network URL); "Add to Home Screen" for full-screen.
- Ship later with Capacitor + a cloud Mac build (Codemagic / GitHub Actions). Needs an Apple Developer account ($99/yr) only at that point.
- Programmer art for prototypes. Monetization: later.

## Fishing (descent & catch)

1. **Cast** — tap to drop the hook.
2. **Descent** — hook sinks, camera follows. Drag left/right to steer and **dodge** fish. Touching a fish hooks it and starts the ascent early (unless a Lucky Lure charge absorbs the hit). Reaching max line length also turns it around.
3. **Ascent** — steer into fish to catch them until the hook is full.
4. **Surface** — catch is tallied and sold.

Deeper zones (Shallows → Open Water → The Deep → Abyss) hold rarer, faster, more valuable fish.

| Upgrade | Effect | Future source |
|---|---|---|
| Longer Line | max depth | Tackle Shop |
| Bigger Hook | fish per trip | Tackle Shop |
| Faster Reel | descent/ascent speed | Tackle Shop |
| Lucky Lure | ignore N hits on the way down | Bait Shop |
| Sonar | see fish below | Lighthouse |

## Town

- Fixed-width grid (6–8 columns), scrolls vertically only; rows unlock as the town levels up.
- Free placement; buildings 1×1 and 2×2.
- Normal mode: drag scrolls, tap building to inspect/upgrade. Build mode: ghost preview (green/red), tap to place.
- Dock at the bottom of the town; tapping it opens the fishing scene.

| Type | Examples | Purpose |
|---|---|---|
| Income | Fish Stand, Smokehouse, Tavern, Market | coins/min, upgradable |
| Utility | Tackle Shop, Bait Shop, Boatyard | unlock fishing upgrades |
| Booster | Lighthouse, Harbor, Aquarium | multipliers, new areas, collection rewards |

Offline earnings accrue while closed, capped (e.g. 4–8 h), cap raised by Harbor/Warehouse.

## Roadmap

1. ~~Project setup, game state, save/load~~
2. ~~Fishing scene: descent, ascent, catching, selling, zones, ~6 fish~~
3. ~~Town scene: vertical grid, build mode, Fish Stand / Tackle Shop / Bait Shop, land expansion~~
4. ~~Passive income + offline earnings (4 h cap)~~
5. ~~Fishing upgrades sold by shops; shop level caps upgrade level~~
6. ~~Move buildings (free) and sell them (50% refund of everything spent)~~
7. Playtest & tune (`src/config.ts`), then content: Smokehouse, Aquarium, boats/new spots, quests, sound, art
   - Open: bigger building sizes, crisp rendering on high-DPI screens

## Dev tips

- In dev builds the browser console has `fv.state` / `fv.save()` / `fv.game`, e.g. `fv.state.coins = 5000`.
