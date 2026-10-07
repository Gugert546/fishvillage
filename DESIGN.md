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

## Town life (residents, jobs, happiness)

**Houses → residents → jobs → income.** Decorations and roads → happiness → bonuses.

- **Housing:** Cottage (1×1, 2 residents), Apartment (2×2, 6 residents, more per level). Residents move in gradually while there's free housing; higher happiness = faster move-ins.
- **Jobs:** workplaces have job slots that grow with level. No workers = no income; each worker adds a share. Tackle/Bait Shops are **closed** (no gear sales) without a shopkeeper.
- **Assignment:** automatic, with manual tweaks per workplace: desired staff `[−][+]` (0..slots) and a ⭐ priority flag that gets filled first.
- **Happiness (0–100%):** per house, averaged over residents. Sources: decorations with an area of effect (Flower bed, Tree, Bench, Fountain…), adjacent road, employment. Range preview while placing.
- **Roads:** bonus only, never required. Villagers walk along them.
- **Effects:** income multiplier (~×0.75 at 0% → ×1.5 at 100%), move-in speed, perks at high happiness. Low happiness never makes residents leave.
- **Alive:** villagers walking home ↔ work, chimney smoke, shopkeeper in the door, "Help wanted!" signs.
- Existing saves get a few starter residents so they keep earning.

## Roadmap

1. ~~Project setup, game state, save/load~~
2. ~~Fishing scene: descent, ascent, catching, selling, zones, ~6 fish~~
3. ~~Town scene: vertical grid, build mode, Fish Stand / Tackle Shop / Bait Shop, land expansion~~
4. ~~Passive income + offline earnings (4 h cap)~~
5. ~~Fishing upgrades sold by shops; shop level caps upgrade level~~
6. ~~Move buildings (free) and sell them (50% refund of everything spent)~~
7. Town life A: houses, residents, jobs (auto + staff/priority), worker-based income, closed shops
8. Town life B: happiness, decorations, roads, range preview, bonuses
9. Town life C: walking villagers, building details
10. Playtest & tune (`src/config.ts`), then content: Smokehouse, Aquarium, boats/new spots, quests, sound, art
   - Open: bigger building sizes, crisp rendering on high-DPI screens

## Dev tips

- In dev builds the browser console has `fv.state` / `fv.save()` / `fv.game`, e.g. `fv.state.coins = 5000`.
