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

Bought in packs of 5 at the Bait Shop (needs a shopkeeper); one is used per cast. Pick it with the bait button on the dock. Bait only lures fish (more fish overall, and some species much more often); it no longer changes sale prices.

| Bait | Town Lv | Price | Lures |
|---|---|---|---|
| Worms | 2 | $20 | 30% more bites |
| Shrimp | 3 | $75 | Cod & Salmon ×3 (and their cousins in other areas) |
| Squid | 4 | $250 | Tuna ×4 |
| Glow Bait | 5 | $800 | Anglerfish ×6 |

### Barrels & selling

- Every catch goes into **barrels on the dock** (50 fish from the start; the Icehouse adds +100 / +250 / +500; Cold Storage perk +25% per rank). Pricier fish get the space first; whatever doesn't fit is sold on the spot at **50%**.
- **Daily prices**: each species has its own price for the day, 60–160% of normal (the fish of the day gets +50% on top). Shown with `^` / `v` on the catch screen and in the market.
- **Selling**: the catch screen has *Sell* (this catch) or *Keep*. The **Barrels** button on the dock (and the Icehouse / Fish Market panels in town) opens the market: sell one species or everything.
- Price bonuses apply **when you sell**: house level, Fish Market, perks & Fisher Statue, storm, festival & Fish Auction, logbook page. A Market Voucher adds +50% to one whole sale. So it pays to wait for a good day, a storm or a festival.
- Orders and upgrades take fish from the same barrels. The Cannery never does: it's fed by the Fishing Wharf.

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

Offline earnings accrue while closed at **half** the usual rate, capped (4 h, raised by the Warehouse, perks and the Railway).

## Your house & town level

Every game starts with your own house above the dock (movable, not sellable). Its level **is the town level**: upgrading costs coins and needs enough residents, unlocks new buildings, and makes fish sell for +10% per level.

| Level | Cost | Needs | Unlocks |
|---|---|---|---|
| 1 | start | – | Cottage, Fish Stand, Tackle Shop, Road, Flower Bed, Tree |
| 2 | $300 | 2 residents | Quests, Bait Shop, Bench |
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
| Lighthouse | 6 | +10 m sonar range (+15 / +20 m at Lv2/3): a ping ring around the hook and red rings on fish and hazards in your path while descending |

## Waterside buildings

Must be placed beside a filled canal; if the water goes away they stop working (blue "!").

| Building | Lv | Jobs | Effect |
|---|---|---|---|
| Moored Boats (decor) | 2 | – | +6 mood within 2 tiles; rowboat floats on the canal |
| Fisherman's Hut | 3 | 2 | $9/min per worker |
| Fish Market | 4 | 4 | +5% dock sale price per worker (+6% / +7% at Lv2/3) |
| Water Mill | 4 | 2 | +10% income per worker for earning workplaces within 6 tiles (also boosts Fillet Houses) |
| Boatyard | 5 | 4 | Sells boats for new fishing areas (needs a worker) |
| Bathhouse | 5 | 4 | +5 mood per worker for homes within 6 tiles (+6 / +7 at Lv2/3) |
| Seafood Restaurant | 6 | 4 | $20/min per worker, +2 mood per worker nearby |

## Quests

Unlocked at town level 2; the Quests button sits between Build and Go Fish (badge = quests ready to claim). Three quests at a time, always ones that are possible right now (fish within the line's reach, unlocked buildings, upgrades within the town level). Claim for coins (sometimes + 3 of the best bait you can buy); Swap a quest for $25 × town level. A toast pops up when one is finished, in town or while fishing.

Kinds: catch N of a fish · fill the hook in one cast · earn $N from fishing · place N decorations · build N road tiles · upgrade a building to Lv N · reach N residents · reach N% happiness. Numbers live in `src/quests.ts` and `QUESTS` in config.

## Town life (residents, jobs, happiness)

**Houses → residents → jobs → income.** Decorations and roads → happiness → bonuses.

- **Housing:** Cottage (2×2 tiles, 2 residents), Apartment (4×4, 6 residents, more per level). Roads and decorations will be 1×1. Residents move in gradually while there's free housing; higher happiness = faster move-ins.
- **Jobs:** workplaces have job slots that grow with level. No workers = no income; each worker adds a share. Tackle/Bait Shops are **closed** (no gear sales) without a shopkeeper.
- **Assignment:** automatic, with manual tweaks per workplace: desired staff `[−][+]` (0..slots) and a ⭐ priority flag that gets filled first.
- **Residents list:** tap the population counter in the top bar. Shows name, job, home and mood; tap a resident to pick their job (Auto / No job / a workplace). Hand-picked jobs are pinned: auto-assignment works around them and may bump auto workers to make room.
- **Happiness (0–100%):** per house, averaged over residents. Sources: decorations with an area of effect (Flower bed, Tree, Bench, Fountain…), adjacent road, employment. Range preview while placing.
- **Roads:** bonus only, never required. Villagers walk along them.
- **Canals:** painted like roads ($10/tile, full refund). Water only flows in through canals connected to the shore (bottom row, where they pass under a little bridge in the boardwalk); unconnected stretches stay dry ditches. Homes beside water get +5 happiness. **Bridges** ($25) go over canals so villagers can cross.
- **Effects:** income multiplier (~×0.75 at 0% → ×1.5 at 100%), move-in speed, perks at high happiness. Low happiness never makes residents leave.
- **Alive:** villagers walking home ↔ work, chimney smoke, shopkeeper in the door, "Help wanted!" signs.
- Existing saves get a few starter residents so they keep earning.

## Fishing areas & boats

Every area beyond the Harbor needs its own boat, bought at the **Boatyard** (town Lv 5, needs at least one worker). Bought boats are moored at the dock; tap one (or the area button on the dock) to sail there. Each area has its own fish, water colours and a hazard.

| Area | Boat | Town Lv | Price | Hazard | Highlights |
|---|---|---|---|---|---|
| Harbor | – | 1 | – | – | Sardine → Anglerfish |
| Open Sea | Fishing Boat | 5 | $25k | **Sharks**: stop the line on the way down, bite a fish off the hook on the way up | fast fish, Marlin |
| Coral Reef | Catamaran | 5 | $90k | **Jellyfish**: sting = hook stunned for a moment | packed with colourful fish |
| Deep Trench | Trawler | 6 | $300k | **Darkness**: you only see near the hook (Lighthouse sonar still tags fish) | winch adds +120 m line, Coelacanth |
| Arctic Waters | Icebreaker | 6 | $1M | **Ice floes**: block the line on the way down (Lucky Lure doesn't help) | priciest fish, Ghost Fish |

## Logbook, legendaries & the Aquarium

- **Logbook** (button on the dock, or the Aquarium): one page per area. Caught species show with count and price; missing ones are silhouettes with their depth range. Finishing every regular species on a page makes that area's fish sell for **+10%**. New species are tagged NEW on the results screen.
- **Legendary fish**, one per area (25% chance per cast to be in the water, if your line reaches): Old Barnacle (Harbor, $1.5k), Silver King (Open Sea, $4k), Coral Emperor (Reef, $5k), Lantern King (Trench, $10k), Frostfin (Arctic, $15k). They glow gold (even in the dark), can't be snagged on the way down, and dart away when the hook gets close — corner them on the way up.
- **Trophies**: catching a legendary unlocks its Trophy decor (2×2, $1k, +12 mood within 4 tiles, one each).
- **Aquarium** (Lv 3, 4×2, 2–4 jobs): $0.5/min per worker for every species in the logbook (+25% per level).

## Icehouse, orders & fish for upgrades

- **Icehouse** (Lv 3, 2×2, no workers): more barrel space (+100 / +250 / +500 fish). See *Barrels & selling*.
- **Orders** (Lv 3, on the Quests board's Orders tab): every 5 min a staffed earning workplace may ask for fish ("Fish Stand wants 8 Cod"), up to 3 at once. Delivering pays 1.5× the fish's value **and** gives that building **+5% income for good** (up to +50%). Orders can be dropped.
- **Fish for upgrades**: upgrading any building to Lv 3 also takes fish from the Icehouse (8 of Cod / Salmon / Tuna / Anglerfish, rarer for later buildings), and house levels 4 / 5 / 6 need 10 Salmon / 8 Tuna / 5 Anglerfish.

## Late game: town levels 7–10, canning & trade, landmarks, perks

- **Town levels 7–10**: $150k / $400k / $1M / $2.5M, 50 / 60 / 70 / 80 residents, and fish from the boat areas: 8 Swordfish, 6 Grouper, 4 Giant Squid, 3 Wolffish.
- **Fishing Wharf** (Lv 6, 4×2, waterside, 2/4/6 jobs): every 2 fishermen crew a little boat (1/2/3 boats). Boats wait by the wharf, sail along the filled canals to the sea, fish, and come home the same way every 6 min, one after another. Each trip brings 10/15/20 Harbor fish (sardines to tuna, better with wharf level) into the wharf's **hold** (100/200/400). When the hold is full the crew sells the extra at plain value.
- **Cannery** (Lv 7, 4×4, 4–6 jobs): each worker cans 0.75–1.25 fish/min from the wharf's hold (never from your barrels). A can is worth 3× the fish; up to 300 cans wait for a ship.
- **Export Docks** (Lv 8, waterside, 4 jobs): a trade ship calls every 10 min, takes 15–25 cans per worker and pays for them. The ship sails in past the pier.
- **Landmarks** (Build → Special, one each, +15 mood within 6 tiles, +1 perk point): Fisher Statue (Lv 7, $100k, fish +10%), Clock Tower (Lv 8, $300k, income +10%), Grand Lighthouse (Lv 9, $800k, legendaries +10%), Harbor Gate (Lv 10, $2M, +8 happiness everywhere).
- **Perk tree** (Perks button in your house): three branches — Fishing (Sharp Hooks, Quick Reel, Big Bucket, Steady Hands, Lucky Charm), Town (Shopkeeping, Welcoming, Cheerful, Long Nap, Prosperity), Trade (Cold Storage, Haggler, Busy Docks, Export Deals, Big Contracts). Tier 2 perks need 2 points in the branch, tier 3 need 4. Points (21 in all): logbook pages, legendaries, every 10 species, town levels 7+, landmarks. Reset is free.

## Day, night, weather & sound

- **Day/night**: a 24-minute cycle on the wall clock (dusk, night, dawn). The scene tints deep blue at night, the moon replaces the sun, windows and lamps glow in town. Night: fish worth $25+ bite 1.5× as often and legendaries are 5% likelier.
- **Weather** (changes every 10 min, same in both scenes): Clear 50%, Cloudy 25%, Rain 18% (30% more fish bite), Storm 7% (boats stay in port and come home between casts; fish sell +25%; lightning). Tap the weather badge (top right) for details and timers.
- **Fish of the day**: one reachable species sells for +50% all day (shown on the dock, tagged TODAY on the catch screen).
- **Daily quest**: catch some of the fish of the day; bigger coin reward + 5 bait, can't be swapped, renewed at midnight.
- **Sound**: synthesised effects (taps, cast splash, catches pitched by value, bumps, stings, coins, fanfares, ship horn) and soft generative pentatonic music, slower at night. Toggles in Settings. Audio starts on the first tap (iOS rule).

## Spending: wages, festivals, the merchant & town projects

- **Wages** (mild): each worker costs 15% of what a typical worker at that building's tier earns (services pay 60% of that), +15% per building level. The top bar shows income after wages (red if negative); coins never drop below $0. Building panels list the wage per worker.
- **Town Square** (Lv 2, 4×4, +8 mood within 4 tiles): host a **festival** for ~10 minutes of town income (min $150). It lasts 30/40/50 min (Square Lv 1/2/3): +25% income, +15 happiness, fish +15%, move-ins ×2, bunting, stalls, confetti and bouncier music.
- **Traveling merchant** (Lv 3): calls every 90 min and stays 30 (a purple boat at the pier; tap it). Three goods per visit, one of each: Golden Lure (next cast's legendary is waiting), Market Voucher (+50% on your next fish sale), Golden Net (+3 hook for 10 casts), Ancient Chart (+1 perk point; $250k, $500k, $750k; max 3), and merchant-only decor (Exotic Palm, Golden Anchor, Koi Pond). Prices grow with town level.
- **Town projects** (Town Square → Board, paid in 10 parts): Weather Station (Lv 4, $50k, rain 60% more fish), Breakwater (Lv 5, $200k, boats sail in storms), Railway Station (Lv 6, $500k, +4h offline, move-ins +25%), Fish Auction (Lv 7, $1M, fish +10%), Trade Office (Lv 8, $2.5M, orders & ships +20%).
- Cosmetics wait for the real art style. Storm damage was considered and dropped (feels unfair).

## Art (pixel art)

Pixel art in the style of a Nordic wharf town: steep gables, slate roofs, white-framed windows,
stone footings, dark ink outlines. It's all drawn in code (`src/art/`), on a grid of 2x2 world px
"art pixels", in the **Endesga 32** palette (lospec.com/palette-list/endesga-32). Use the same
palette when drawing your own sprites so they fit in.

- `src/pixel.ts`: the painter. Takes world coordinates like Phaser's Graphics, snaps everything to
  art pixels and the palette, outlines shapes in ink, and turns the result into a texture.
- `src/art/kit.ts`: building blocks (walls, gables, tiled roofs, windows, doors, awnings, signs).
- `src/art/buildings.ts`, `decor.ts`, `ground.ts`, `people.ts`, `icons.ts`: the pictures.
- Text uses the bundled Tiny5 font. It's drawn on an 8 px grid, so text is only sharp at 16, 24
  or 32 px; `makeText` snaps every size to one of those. Tiny5 has no arrows, ticks or stars:
  use `>`, `[x]`/`[ ]` and `*` instead.
- The whole game renders with Phaser's `pixelArt` mode, so the canvas scales up without blur.

**Your own sprites.** Drop a PNG into `assets/sprites/`, named after the building, decoration or
tile id (`cottage.png`, `tree.png`, `road.png`), and the game uses it instead of the built-in
art. In dev the page reloads by itself when a file is added.

- Scale: 16x16 px per tile, shown at 2x, so a tile is 32 px in game.
- Buildings and decorations sit bottom-left on their footprint, so roofs can poke up above it.
- Sizes: 1x1 tile = 16x16; 2x2 = 32x32; 4x2 = 64x32; 4x4 = 64x64; 2x4 = 32x64 (plus roof height).
  Villagers are 7x11.
- Roads: one plain tile, stretched to fill each road tile (the built-in roads join up with curbs;
  a custom road doesn't yet).

## Plans

**Phase 1 — Boats & fishing areas** ✅ Open Sea, Coral Reef, Deep Trench, Arctic Waters; one boat each from the Boatyard; hazards per area.

**Phase 2 — Fishing gives what the town can't** ✅ Logbook + Aquarium, a legendary per area with trophies, orders and fish needed for upgrades.

**Phase 3 — Long-term goals** ✅ Town levels 7–10, Cannery → Export Docks → trade ships, landmarks, perk tree (no prestige / resets).

**Phase 4 — Life & atmosphere** ✅ Day/night, weather, fish of the day, daily quest, synthesised sound & music, pixel art restyle (Nordic wharf town, Endesga 32).

**Phase 5 — Economy balance** ✅ Mild wages, Town Square festivals, traveling merchant, town projects, barrels with daily fish prices and a market, Fishing Wharf feeding the Cannery, offline earnings at half rate. Ongoing: tune numbers from playtests.

**Phase 6 — Deeper fishing** ✅ (tune from playtests)
- **Legendary fights**: touching a legendary on the way up starts a fight. The hook stops and the fish thrashes side to side; keep the hook on it (within ~38 px) to fill the green reel bar (5 s). Off the fish, the red tension bar rises; full tension (~2 s) snaps the line and the legendary escapes for the rest of the cast.
- **Treasure & junk**: a chest on the sea floor (35% per cast, reachable only at full line length): coins (60 × town level × area number, ±30%), sometimes 3 of your best bait or a charm. A bottle near the surface (20%): its note puts an area's legendary in the water on your next cast there. Boots and cans: $1 and a smile. Items take hook space and open on the catch screen.
- **Rods** (Tackle Shop → Rods, switch on the dock): Harpoon (Lv 3, $3k: a Fire button on the way down spears the first fish below, once a cast, without ending the descent), Magnet Rod (Lv 4, $12k: twice the treasure, pulls it toward the hook), Wide Net (Lv 5, $30k: 60% wider catch on the way up).
- **Combos**: the same species again and again pays 25% of its price per step (×2 = +25%, ×3 = +50%…), paid on the catch screen.

**Phase 7 — Reasons to return**
- **Seasons** (one per real week): fish availability shifts, harbor ice in winter, a summer festival.
- **Weekly fishing tournament**: a target species or total weight, with a trophy and perk-point rewards.
- **Achievements**: milestones with small rewards and a badge wall in your house.

**Phase 8 — A livelier town**
- **Tourists**: a Ferry Terminal brings visitors who walk to shops and spend; happiness and landmarks draw more.
- **Resident requests**: "Ida wants a bench by her home", "Nils wants a job at the Tavern", for small rewards.
- **Street bonuses**: shops in a row along a road form a "Market Street" with a bonus.

**Phase 9 — Cosmetics** (once the art style has settled)
- Recolour buildings (wall, roof and trim colours from the palette), boat paint jobs, dock skins.
- Many more decorations: flower boxes, statues, market stalls, seasonal pieces.
- Unlocked with coins, achievements, tournament rewards and the merchant.

**Phase 10 — Onboarding & clarity** (once the systems have settled)
- Guided first steps (first cast, sale, building, worker), then hints as each system unlocks.
- "?" help on panels (wages, daily prices, orders…).
- A stats screen: income vs. wages, best catch, totals.

**Phase 11 — Tech & quality of life**
- Save export/import (a backup code, since iOS can clear localStorage), cloud save later.
- Haptics, a performance pass on older iPhones, notch/safe-area polish.

**Phase 12 — Ship to iPhone** (on hold): Capacitor, Codemagic cloud build, TestFlight (needs the Apple Developer account).

## Done so far

1. ~~Project setup, game state, save/load~~
2. ~~Fishing scene: descent, ascent, catching, selling, zones, ~6 fish~~
3. ~~Town scene: vertical grid, build mode, Fish Stand / Tackle Shop / Bait Shop, land expansion~~
4. ~~Passive income + offline earnings (4 h cap)~~
5. ~~Fishing upgrades sold by shops; shop level caps upgrade level~~
6. ~~Move buildings (free) and sell them (50% refund of everything spent)~~
7. ~~Town life A: grid, Cottage/Apartment, residents, jobs (auto + staff/priority), worker-based income, closed shops~~
8. ~~Town life B: happiness, decorations with area effect, road painting tool, range preview, income/move-in bonuses~~
9. ~~Town life C: walking villagers (road-preferring pathfinding), shopkeepers, chimney smoke, lamp/fountain animation~~
10. ~~Your house & town levels, bait, Fillet House, residents list, service buildings, quests, canals, pier, waterside buildings~~
11. ~~Boats & fishing areas (Phase 1)~~
12. ~~Logbook, legendaries, trophies, Aquarium; Icehouse, orders, fish for upgrades (Phase 2)~~
13. ~~Town levels 7–10, canning & trade, landmarks, perk tree (Phase 3)~~
14. ~~Day/night, weather, daily quest, fish of the day, sound (Phase 4)~~
15. ~~Pixel art restyle, Tiny5 font, custom sprite support~~
16. ~~Wages, festivals, merchant, town projects, barrels & daily prices, Fishing Wharf, half-rate offline (Phase 5)~~

## Dev tips

- Settings (gear, top-right) has Reset game. In dev builds (`npm run dev`) it also has playtesting tools:
  - **Free mode** (on by default in dev): buildings, upgrades, gear, boats, rods, bait, festivals, projects and merchant goods cost nothing; closed shops still sell; fish and resident requirements for upgrades are skipped. Switch it off to test the real economy. Shipped builds always pay full price.
  - +$1k / +$10k / +$100k, Skip 1 hour.
  - **Max town lv** (house to level 10), **Unlock gear** (every boat and rod, fishing upgrades maxed, 20 of each bait), **Legend next** (the legendary waits on your next cast), **Fill barrels** (a random mix of fish from your areas).
  - Closing Settings on the dock restocks the water, so new gear and "Legend next" apply right away.
- In dev builds the browser console has `fv.state` / `fv.save()` / `fv.game`, e.g. `fv.state.coins = 5000`.
