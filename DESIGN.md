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

### Bait

Bought in packs of 5 at the Bait Shop (needs a shopkeeper); one is used per cast. Pick it with the bait button on the dock. Bait raises sale price and lures better fish (more fish overall, and some species much more often).

| Bait | Town Lv | Price | Sale bonus | Lures |
|---|---|---|---|---|
| Worms | 2 | $20 | +10% | more fish |
| Shrimp | 3 | $75 | +15% | Cod & Salmon ×2 |
| Squid | 4 | $250 | +20% | Tuna ×2.5 |
| Glow Bait | 5 | $800 | +25% | Anglerfish ×4 |

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

All passive income is designed and shown **per minute** (a Lv1 Fish Stand worker earns $6/min); fishing is the main early income. Town expansions start at $10k (×1.5 each).

Offline earnings accrue while closed, capped (e.g. 4–8 h), cap raised by Harbor/Warehouse.

## Your house & town level

Every game starts with your own house above the dock (movable, not sellable). Its level **is the town level**: upgrading costs coins and needs enough residents, unlocks new buildings, and makes fish sell for +10% per level.

| Level | Cost | Needs | Unlocks |
|---|---|---|---|
| 1 | start | – | Cottage, Fish Stand, Tackle Shop, Road, Flower Bed, Tree |
| 2 | $300 | 2 residents | Bait Shop, Bench |
| 3 | $1,500 | 6 residents | Apartment, Lamp Post, Fillet House, Warehouse |
| 4 | $6,000 | 12 residents | Fountain, Tavern |
| 5 | $20,000 | 24 residents | Net Maker |
| 6 | $60,000 | 40 residents | Lighthouse |

Fish Stands: 2 at level 1, then **+1 per level**. No building can be upgraded past the town level.

**Fillet House** (4×2, 4 jobs, one per town): earns nothing itself, but each worker makes every Fish Stand earn +10% (+12.5% at Lv2, +15% at Lv3).

**Services** (4 jobs each, earn nothing directly; Build menu → Services):

| Building | Town Lv | Each worker gives |
|---|---|---|
| Warehouse | 3 | +1h offline earnings cap (+1.25h / +1.5h at Lv2/3) |
| Tavern (max 3) | 4 | +4 happiness to homes within 5 tiles (+5 / +6 at Lv2/3) |
| Net Maker | 5 | +1 hook capacity |
| Lighthouse | 6 | +10 m sonar range (+15 / +20 m at Lv2/3): price tags on fish in range, red rings on fish in your path while descending |

## Town life (residents, jobs, happiness)

**Houses → residents → jobs → income.** Decorations and roads → happiness → bonuses.

- **Housing:** Cottage (2×2 tiles, 2 residents), Apartment (4×4, 6 residents, more per level). Roads and decorations will be 1×1. Residents move in gradually while there's free housing; higher happiness = faster move-ins.
- **Jobs:** workplaces have job slots that grow with level. No workers = no income; each worker adds a share. Tackle/Bait Shops are **closed** (no gear sales) without a shopkeeper.
- **Assignment:** automatic, with manual tweaks per workplace: desired staff `[−][+]` (0..slots) and a ⭐ priority flag that gets filled first.
- **Residents list:** tap the population counter in the top bar. Shows name, job, home and mood; tap a resident to pick their job (Auto / No job / a workplace). Hand-picked jobs are pinned: auto-assignment works around them and may bump auto workers to make room.
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
7. ~~Town life A: 14×14 grid (30px tiles), Cottage/Apartment, residents, jobs (auto + staff/priority), worker-based income, closed shops~~
8. ~~Town life B: happiness (per resident, 50% neutral), decorations with area effect, road painting tool, range preview, income/move-in bonuses~~
9. ~~Town life C: walking villagers (road-preferring pathfinding), shopkeepers, chimney smoke, lamp/fountain animation~~
10. Playtest & tune (`src/config.ts`), then content: Smokehouse, Aquarium, boats/new spots, quests, sound, art
   - Open: bigger building sizes, crisp rendering on high-DPI screens

## Dev tips

- Settings (gear, top-right) has Reset game; in dev builds it also has playtesting tools: +$1k/+$10k/+$100k and Skip 1 hour.
- In dev builds the browser console has `fv.state` / `fv.save()` / `fv.game`, e.g. `fv.state.coins = 5000`.
