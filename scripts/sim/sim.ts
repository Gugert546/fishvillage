// Headless progression simulator: a sensible player from a fresh save to town level 10.
//
//   node scripts/sim/sim.ts                  # both profiles (grinder, daily), median of 20 runs each
//   node scripts/sim/sim.ts --profile daily  # just one profile: grinder | daily
//   node scripts/sim/sim.ts --seeds 50 --log # more runs, plus a purchase log of the first run
//   node scripts/sim/sim.ts --set TOWN_LEVELS.5.cost=30000 --set UPGRADES.0.levelsPerShopLevel=2
//   node scripts/sim/sim.ts --set OFFLINE_RATE=0.75 --fn 'BUILDING_BY_ID.fishStand.incomePerWorker=(l)=>8*1.3**(l-1)'
//
// It imports the real numbers from src/config.ts (Node 23+ strips the types; `window` is stubbed),
// so a rebalance shows up here without touching the sim. The rules of the game are re-modelled in
// a simplified form below; see PLAYTEST-SIM.md for the assumptions.

(globalThis as any).window = { innerHeight: 900, innerWidth: 450 };
const C = await import('../../src/config.ts');
const {
  AREAS, BAITS, BUILDING_BY_ID, FISH, FLEET, FESTIVAL, HAPPINESS, LEGENDARY, ORDERS, QUESTS, REQUESTS,
  TOURISM, TOWN_LEVELS, TRADE, TREASURE, UPGRADES, UPGRADE_FISH, WAGES, WIDE_NET_REACH, COMBO_BONUS,
  FIRST_MOVE_IN_SECONDS, START_ROWS, ROWS_PER_EXPANSION, TOWN_COLS,
  upgradeCost, upgradeFishAmount, expansionCost, FULL_HOOK_REEL_MULTIPLIER,
} = C;

// ------------------------------------------------------------------ CLI

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, dflt: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
// Plain-number exports can't be changed on the module, so the sim reads them from here.
const K = {
  OFFLINE_RATE: C.OFFLINE_RATE,
  OFFLINE_CAP_HOURS: C.OFFLINE_CAP_HOURS,
  FISH_PRICE_BONUS_PER_LEVEL: C.FISH_PRICE_BONUS_PER_LEVEL,
  MOVE_IN_SECONDS: C.MOVE_IN_SECONDS,
};
// --set PATH=VALUE overrides a number in the config, e.g. TOWN_LEVELS.5.cost=30000 or OFFLINE_RATE=0.75,
// or a player assumption below with an A. prefix, e.g. A.catchChance=0.35.
// --fn PATH=EXPR replaces a function, e.g. 'BUILDING_BY_ID.fishStand.incomePerWorker=(l)=>8*1.3**(l-1)'.
function applySets(target: 'A' | 'C') {
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--set' && argv[i] !== '--fn') continue;
  const eq = argv[i + 1].indexOf('=');
  const path = argv[i + 1].slice(0, eq);
  const raw = argv[i + 1].slice(eq + 1);
  const value = argv[i] === '--fn' ? new Function(`return (${raw});`)() : Number(raw);
  const keys = path.split('.');
  if ((keys[0] === 'A') !== (target === 'A')) continue;
  if (target === 'A') keys.shift();
  if (target === 'C' && keys.length === 1 && keys[0] in K) {
    (K as any)[keys[0]] = value;
    continue;
  }
  let obj: any = target === 'A' ? A : C;
  for (const k of keys.slice(0, -1)) obj = obj[k];
  obj[keys[keys.length - 1]] = value;
}
}
applySets('C');

// ------------------------------------------------------------------ Player-model assumptions

const A = {
  /** Seconds per cast spent outside descent/ascent: casting, results screen, selling. */
  castOverhead: 8,
  /** Chance per fish on the way down that the player can't dodge it (then it's hooked). */
  hitChance: 0.012,
  /** Chance per hazard (shark, ice) in the path that it stops the line. */
  hazardStop: 0.04,
  /** Chance to catch each fish passed on the way up, bottom first. */
  catchChance: 0.5,
  /** Chance to win a legendary fight once it's on the way up. */
  legendWin: 0.35,
  /** Seconds a legendary fight takes. */
  fightSeconds: 6,
  /** Average daily price factor the player sells at (60–160% swing, fish of the day, some waiting). */
  dailyPrice: 1.1,
  /** Per-area catch efficiency for hazards/darkness. */
  areaPenalty: { harbor: 1, openSea: 0.85, reef: 0.9, trench: 0.85, arctic: 0.85 } as Record<string, number>,
  /** Decorations + arrangements per home, by town level (on top of 35 base + 5 road + 10 job = 50). */
  decorMood: [0, 8, 13, 16, 20, 22, 24, 25, 25, 25, 25],
  /** Decoration spend per new home, × town level (shared flower beds, trees, benches, lamps). */
  decorCostPerHome: 25,
  /** Quests: one completed every this many minutes of play. */
  questEveryMin: 4,
  /** Share of resident requests and orders the player fulfils. */
  requestShare: 0.5,
  orderShare: 0.5,
  /** Tiles a building really takes, with its share of roads and decorations. */
  tileOverhead: 1.5,
  /** Monte Carlo casts per fishing-rate estimate. */
  rateCasts: 300,
  /** Stop after this many hours of play (grinder) or days (daily player). */
  maxHours: 300,
  maxDays: 120,
  /** Daily player: active minutes per session, then the away gaps that follow each session, in hours. */
  sessionMin: 20,
  awayHours: [8, 15.33],
  /** 1 = a festival costs 10 min of town income *plus* fishing (a suggested fix in festival.ts). */
  festivalCountsFishing: 0,
};
/** grinder: fishes non-stop, never away. daily: two short sessions a day, away in between. */
const PROFILES = ['grinder', 'daily'] as const;
type Profile = (typeof PROFILES)[number];
let profile: Profile = 'grinder';
applySets('A');

// ------------------------------------------------------------------ RNG

let seed = 1;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ State

type FishT = (typeof FISH)[number];
const fishById = Object.fromEntries(FISH.map((f) => [f.id, f])) as Record<string, FishT>;
const areaIndex = Object.fromEntries(AREAS.map((a, i) => [a.id, i])) as Record<string, number>;

interface B {
  type: string;
  level: number;
}

interface S {
  t: number; // seconds of play
  coins: number;
  tl: number; // town level (house level)
  up: Record<string, number>;
  rod: string;
  rods: Set<string>;
  areas: Set<string>;
  bldgs: B[];
  residents: number;
  moveTimer: number;
  ice: Record<string, number>; // fish kept for upgrades
  expansions: number;
  orderDeliveries: number;
  trophies: number;
  questTimer: number;
  orderTimer: number;
  requestTimer: number;
  log: string[];
  /** Why the house upgrade waited, sampled each cast: coins / residents / fish. */
  gate: Record<string, number>;
  levelAt: number[];
  levelGate: Record<string, number>[];
  /** Income ($/min) and its fishing share right after each level-up. */
  incomeAt: number[];
  fishingShare: number[];
  /** Real time in seconds, away time included (= t for the grinder). */
  real: number;
  away: boolean;
  /** Whether the player keeps a festival going (decided as they play). */
  festOn: boolean;
  /** Coins earned so far by source, and a copy at each level-up. */
  src: Src;
  srcAt: Src[];
  activeAt: number[];
  /** Town income and wages ($/min, no festival) on arrival at each level. */
  townAt: { gross: number; wages: number }[];
}

interface Src {
  fishing: number;
  town: number;
  offline: number;
}

const def = (type: string) => BUILDING_BY_ID[type as keyof typeof BUILDING_BY_ID];
const count = (s: S, type: string) => s.bldgs.filter((b) => b.type === type).length;
const best = (s: S, type: string) => s.bldgs.reduce((m, b) => (b.type === type ? Math.max(m, b.level) : m), 0);

function newState(): S {
  return {
    t: 0, coins: 0, tl: 1, up: { line: 0, capacity: 0, reel: 0, shield: 0 }, rod: 'classic', rods: new Set(['classic']),
    areas: new Set(['harbor']), bldgs: [{ type: 'playerHouse', level: 1 }], residents: 0, moveTimer: 0, ice: {},
    expansions: 0, orderDeliveries: 0, trophies: 0, questTimer: 0, orderTimer: 0, requestTimer: 0, log: [],
    gate: {}, levelAt: [0, 0], levelGate: [{}, {}], incomeAt: [], fishingShare: [],
    real: 0, away: false, festOn: true, src: { fishing: 0, town: 0, offline: 0 }, srcAt: [{ fishing: 0, town: 0, offline: 0 }, { fishing: 0, town: 0, offline: 0 }],
    activeAt: [0, 0], townAt: [],
  };
}

// ------------------------------------------------------------------ Town economy

const jobsOf = (b: B) => def(b.type).jobs?.(b.level) ?? 0;
const housingCap = (s: S) => s.bldgs.reduce((n, b) => n + (def(b.type).housing?.(b.level) ?? 0), 0);
const totalJobs = (s: S) => s.bldgs.reduce((n, b) => n + jobsOf(b), 0);

function wage(b: B): number {
  const d = def(b.type);
  if (!d.jobs) return 0;
  const grade = d.incomePerWorker?.(1) ?? WAGES.grade[d.unlockLevel ?? 1];
  const service = d.incomePerWorker || d.speciesIncomePerWorker ? 1 : WAGES.serviceFactor;
  return WAGES.share * grade * service * (1 + WAGES.perLevel * (b.level - 1));
}

const scale = (h: number, z: number, f: number) => (h <= 50 ? z + (1 - z) * (h / 50) : 1 + (f - 1) * ((h - 50) / 50));
const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Happiness of an employed resident in a decorated home with a road. */
function homeMood(s: S, festival: boolean): number {
  let h = HAPPINESS.base + HAPPINESS.roadNextToHome + HAPPINESS.employed + A.decorMood[s.tl];
  // Taverns/Bathhouses: one in reach of most homes, staffed; counted as the top surroundings entry.
  for (const b of s.bldgs) {
    const m = def(b.type).moodPerWorker;
    if (m && !def(b.type).incomePerWorker) h += 0.5 * m.amount(b.level) * Math.min(jobsOf(b), 4) * 0.5;
  }
  if (s.tl >= REQUESTS.unlockLevel) h += 3; // request cheer, averaged
  if (festival) h += FESTIVAL.happiness;
  return clamp(h);
}

/** Who works where: the player gives the best-paying jobs priority. Returns workers per building index. */
function staffing(s: S): number[] {
  const order = s.bldgs.map((b, i) => [i, perWorkerValue(s, b)] as const).filter(([, v]) => v > -Infinity);
  order.sort((a, b) => b[1] - a[1]);
  const out = s.bldgs.map(() => 0);
  let free = s.residents;
  for (const [i] of order) {
    const n = Math.min(free, jobsOf(s.bldgs[i]));
    out[i] = n;
    free -= n;
  }
  return out;
}

/** Rough priority for staffing: essential shops first, then by earnings. */
function perWorkerValue(s: S, b: B): number {
  const d = def(b.type);
  if (!d.jobs) return -Infinity;
  if (b.type === 'tackleShop' || b.type === 'baitShop' || b.type === 'boatyard') return 1000;
  if (d.hookPerWorker || d.dockPricePerWorker) return 500;
  if (d.offlineHoursPerWorker) return profile === 'daily' ? 400 : -1;
  return (d.incomePerWorker?.(b.level) ?? 10) - wage(b);
}

interface Town {
  gross: number; // coins/min before wages
  wages: number;
  trade: number; // part of gross from the wharf and trade ships (paid in full while away)
  offlineCap: number; // hours
  fishPrice: number; // extra sale price share from Fish Markets
  hook: number; // Net Maker capacity
  happiness: number;
}

function town(s: S, festival = festivalOn(s)): Town {
  const staff = staffing(s);
  const employed = staff.reduce((a, b) => a + b, 0);
  const hEmp = homeMood(s, festival);
  const hUnemp = clamp(hEmp - HAPPINESS.employed + HAPPINESS.unemployed);
  const happiness = s.residents ? (employed * hEmp + (s.residents - employed) * hUnemp) / s.residents : 50;
  const mult = scale(hEmp, HAPPINESS.incomeAtZero, HAPPINESS.incomeAtFull);
  const ordersBoost = Math.min(ORDERS.maxBoost, (ORDERS.boostPerDelivery * s.orderDeliveries) / Math.max(1, earners(s)));
  const townMult = (1 + (festival ? FESTIVAL.income : 0)) * (1 + (s.bldgs.some((b) => b.type === 'clockTower') ? 0.1 : 0));
  let filletBoost = 0;
  let mills = 0;
  let fishPrice = 0;
  let hook = 0;
  let wages = 0;
  let offlineCap = K.OFFLINE_CAP_HOURS;
  staff.forEach((n, i) => {
    const b = s.bldgs[i];
    const d = def(b.type);
    wages += wage(b) * n;
    if (d.standBoostPerWorker) filletBoost += d.standBoostPerWorker(b.level) * n;
    if (d.millPerWorker) mills += d.millPerWorker.amount * n;
    if (d.dockPricePerWorker) fishPrice += d.dockPricePerWorker(b.level) * n;
    if (d.hookPerWorker) hook += d.hookPerWorker * n;
    if (d.offlineHoursPerWorker) offlineCap += d.offlineHoursPerWorker(b.level) * n;
  });
  // A mill reaches about half of the town's workplaces.
  const millMult = 1 + mills * 0.5;
  let gross = 0;
  staff.forEach((n, i) => {
    const b = s.bldgs[i];
    const d = def(b.type);
    let per = d.incomePerWorker?.(b.level) ?? 0;
    if (d.speciesIncomePerWorker) per = d.speciesIncomePerWorker(b.level) * speciesSeen(s);
    if (!per || !n) return;
    // Road +10%, market street about +10% on average.
    let v = per * n * mult * 1.1 * 1.1 * millMult * (1 + ordersBoost) * townMult;
    if (b.type === 'fishStand') v *= 1 + filletBoost;
    gross += v;
  });
  // Tourists
  const ferry = s.bldgs.findIndex((b) => b.type === 'ferryTerminal');
  if (ferry >= 0 && staff[ferry] > 0) {
    const b = s.bldgs[ferry];
    let attraction = 1 + (TOURISM.happinessWeight * (happiness - 50)) / 50;
    if (s.bldgs.some((x) => x.type === 'aquarium')) attraction += TOURISM.aquarium;
    attraction += s.trophies * TOURISM.perTrophy;
    attraction += s.bldgs.filter((x) => def(x.type).landmark).length * TOURISM.perLandmark;
    attraction += Math.min(0.5, (s.tl >= 4 ? 3 : s.tl >= 2 ? 2 : 0) * 0.1); // arrangement types
    if (festival) attraction *= TOURISM.festival;
    attraction = Math.min(TOURISM.maxAttraction, attraction);
    const tourists = Math.round(def('ferryTerminal').tourists!(b.level) * (staff[ferry] / jobsOf(b)) * attraction);
    gross += tourists * (TOURISM.spendBase + TOURISM.spendPerLevel * s.tl) * townMult;
  }
  // Wharf → Cannery → Export Docks
  let trade = 0;
  const wharf = s.bldgs.findIndex((b) => b.type === 'fishingWharf');
  if (wharf >= 0 && staff[wharf] >= 2) {
    const lvl = s.bldgs[wharf].level;
    const boats = Math.floor(staff[wharf] / FLEET.crewPerBoat);
    const fishPerMin = (boats * def('fishingWharf').fleet!.haul(lvl)) / FLEET.tripMinutes;
    const mix = FLEET.catch[lvl];
    const wsum = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
    const avgValue = Object.entries(mix).reduce((a, [id, w]) => a + fishById[id].value * (w ?? 0), 0) / wsum;
    let canned = 0;
    const can = s.bldgs.findIndex((b) => b.type === 'cannery');
    const docks = s.bldgs.findIndex((b) => b.type === 'exportDocks');
    if (can >= 0 && docks >= 0) {
      const canRate = staff[can] * def('cannery').cansPerWorker!(s.bldgs[can].level);
      const shipRate = (staff[docks] * def('exportDocks').shipCansPerWorker!(s.bldgs[docks].level)) / (TRADE.shipEverySeconds / 60);
      canned = Math.min(fishPerMin, canRate, shipRate);
    }
    trade = canned * avgValue * TRADE.canValue + (fishPerMin - canned) * avgValue;
    gross += trade;
  }
  return { gross, wages, trade, offlineCap, fishPrice, hook, happiness };
}

const earners = (s: S) => s.bldgs.filter((b) => def(b.type).incomePerWorker || def(b.type).speciesIncomePerWorker).length;
const speciesSeen = (s: S) => FISH.filter((f) => !f.legendary && s.areas.has(f.area)).length * 0.8;

/** Festivals (no cooldown): kept going while it pays, never while away (they end long before you return). */
const festivalOn = (s: S) => s.festOn && !s.away && s.bldgs.some((b) => b.type === 'townSquare');
function festivalCostPerMin(s: S): number {
  if (!festivalOn(s)) return 0;
  const t = town(s, false);
  let basis = t.gross;
  if (A.festivalCountsFishing) {
    s.festOn = false;
    basis += bestFishing(s, t).r.coinsPerMin;
    s.festOn = true;
  }
  const sq = best(s, 'townSquare');
  // A daily player only enjoys the part of it that falls in their session.
  const minutes = profile === 'daily' ? Math.min(FESTIVAL.minutes(sq), A.sessionMin) : FESTIVAL.minutes(sq);
  return Math.max(FESTIVAL.minCost, basis * FESTIVAL.costMinutes) / minutes;
}

/** Coins per minute while away (before the cap): town income after wages at the offline rate, trade in full. */
function offlinePerMin(s: S, t = town(s, false)): number {
  return (t.gross - t.trade - t.wages) * K.OFFLINE_RATE + t.trade;
}

/** Offline coins per day for the daily player, given the cap. */
function offlinePerDay(s: S): number {
  if (profile !== 'daily') return 0;
  const t = town(s, false);
  const mins = A.awayHours.reduce((a, h) => a + Math.min(h, t.offlineCap) * 60, 0);
  return Math.max(0, offlinePerMin(s, t)) * mins;
}

// ------------------------------------------------------------------ Fishing

interface Gear {
  area: string;
  line: number;
  cap: number;
  shields: number;
  ds: number;
  as: number;
  bait?: string;
  rod: string;
  priceMult: number;
  tl: number;
  keep?: string; // fish species to keep for upgrades (counted, not sold)
}

interface Cast {
  seconds: number;
  coins: number;
  fish: Record<string, number>;
  legend: boolean;
}

function cast(g: Gear): Cast {
  const area = AREAS[areaIndex[g.area]];
  const bait = BAITS.find((b) => b.id === g.bait);
  const line = Math.min(g.line + area.lineBonus, area.depth);
  const pen = A.areaPenalty[g.area];
  // Spawn the water column (only what's above the line matters).
  const fish: { f: FishT; d: number }[] = [];
  const dens = area.density * (bait?.density ?? 1);
  const options = FISH.filter((f) => f.area === g.area && !f.legendary);
  for (let seg = 0; seg < line; seg += 10) {
    const n = Math.floor(dens + rand());
    for (let i = 0; i < n; i++) {
      const d = seg + rand() * 10;
      if (d > line) continue;
      const here = options.filter((f) => d >= f.minDepth && d <= f.maxDepth);
      if (!here.length) continue;
      const w = (f: FishT) => f.weight * (bait?.attract[f.id] ?? 1);
      let roll = rand() * here.reduce((a, f) => a + w(f), 0);
      let pick = here[here.length - 1];
      for (const f of here) if ((roll -= w(f)) <= 0) { pick = f; break; }
      fish.push({ f: pick, d });
    }
  }
  fish.sort((a, b) => a.d - b.d);
  const legend = FISH.find((f) => f.legendary && f.area === g.area)!;
  const legendDepth = rand() < LEGENDARY.chance && legend.minDepth <= line ? legend.minDepth + rand() * (Math.min(legend.maxDepth, line - 5) - legend.minDepth) : -1;
  // Hazards that stop the descent.
  let turn = line;
  if (area.hazard && area.hazard.kind !== 'jelly') {
    for (let d = area.hazard.minDepth; d < line; d += 10) {
      if (rand() < area.hazard.perTenM * A.hazardStop) { turn = Math.min(turn, d + rand() * 10); break; }
    }
  }
  // Descent: dodge, unless a fish is unavoidable; Lucky Lure / harpoon absorb hits.
  let shields = g.shields;
  let harpoon = g.rod === 'harpoon' ? 1 : 0;
  const caught: FishT[] = [];
  for (const x of fish) {
    if (x.d > turn) break;
    if (rand() >= A.hitChance) continue;
    if (harpoon) { harpoon--; caught.push(x.f); x.d = -1; continue; }
    if (shields) { shields--; continue; }
    turn = x.d;
    caught.push(x.f);
    x.d = -1;
    break;
  }
  // Ascent: catch on the way up, deepest (= priciest) first.
  let p = A.catchChance * pen * (g.rod === 'wideNet' ? WIDE_NET_REACH * 0.8 : 1);
  p = Math.min(0.85, p);
  let coins = 0;
  let fillDepth = 0;
  let gotLegend = false;
  let fight = 0;
  // Treasure chest on the floor, only when the line reaches the bottom.
  if (turn >= area.depth - 1 && caught.length < g.cap) {
    const chance = Math.min(0.9, TREASURE.chestChance * (g.rod === 'magnet' ? 2 : 1));
    if (rand() < chance && rand() < (g.rod === 'magnet' ? 1 : 0.8)) {
      coins += TREASURE.chestCoins * g.tl * (areaIndex[g.area] + 1);
      caught.push(null as any); // takes a slot
    }
  }
  const upward = fish.filter((x) => x.d >= 0 && x.d <= turn).reverse();
  let li = legendDepth >= 0 && legendDepth <= turn ? legendDepth : -1;
  for (const x of upward) {
    if (caught.length >= g.cap) break;
    if (li >= 0 && li > x.d) {
      li = -1;
      fight = A.fightSeconds;
      if (rand() < A.legendWin * pen) { gotLegend = true; caught.push(legend); }
      if (caught.length >= g.cap) { fillDepth = x.d; break; }
    }
    if (rand() < p) {
      caught.push(x.f);
      if (caught.length >= g.cap) fillDepth = x.d;
    }
  }
  const real = caught.filter(Boolean);
  // Sell: daily price, bonuses, combos for repeats in a row.
  const out: Record<string, number> = {};
  let prev = '';
  let streak = 0;
  for (const f of real) {
    out[f.id] = (out[f.id] ?? 0) + 1;
    if (f.id === g.keep) continue;
    const price = f.value * A.dailyPrice * g.priceMult;
    streak = f.id === prev ? streak + 1 : 0;
    prev = f.id;
    coins += price * (1 + COMBO_BONUS * streak);
  }
  const fast = g.as * FULL_HOOK_REEL_MULTIPLIER;
  const ascent = caught.length >= g.cap ? (turn - fillDepth) / g.as + fillDepth / fast : turn / g.as;
  const seconds = A.castOverhead + turn / g.ds + ascent + fight;
  return { seconds, coins, fish: out, legend: gotLegend };
}

interface Rate {
  coinsPerMin: number; // after bait cost
  fishPerMin: Record<string, number>;
}

const rateCache = new Map<string, Rate>();
function rate(g: Gear): Rate {
  const key = JSON.stringify(g);
  const hit = rateCache.get(key);
  if (hit) return hit;
  const saved = seed;
  seed = 12345;
  let secs = 0;
  let coins = 0;
  const fish: Record<string, number> = {};
  for (let i = 0; i < A.rateCasts; i++) {
    const c = cast(g);
    secs += c.seconds;
    coins += c.coins;
    for (const [id, n] of Object.entries(c.fish)) fish[id] = (fish[id] ?? 0) + n;
  }
  seed = saved;
  const bait = BAITS.find((b) => b.id === g.bait);
  const baitCost = bait ? (bait.packCost / bait.packSize) * A.rateCasts : 0;
  const mins = secs / 60;
  const r = { coinsPerMin: (coins - baitCost) / mins, fishPerMin: Object.fromEntries(Object.entries(fish).map(([k, v]) => [k, v / mins])) };
  rateCache.set(key, r);
  return r;
}

const shopOpen = (s: S, type: string) => {
  const i = s.bldgs.findIndex((b) => b.type === type);
  return i >= 0 && staffing(s)[i] > 0;
};

function baseGear(s: S, t: Town): Omit<Gear, 'area' | 'bait'> {
  const st = { lineLength: 40, capacity: 3, shields: 0, descentSpeed: 7, ascentSpeed: 9 };
  for (const u of UPGRADES) u.apply(st as any, s.up[u.id]);
  const price = 1 + K.FISH_PRICE_BONUS_PER_LEVEL * (s.tl - 1) + t.fishPrice + (festivalOn(s) ? FESTIVAL.fishPrice : 0)
    + (s.bldgs.some((b) => b.type === 'statue') ? 0.1 : 0);
  return {
    line: st.lineLength, cap: st.capacity + t.hook, shields: st.shields, ds: st.descentSpeed, as: st.ascentSpeed,
    rod: s.rod, priceMult: price, tl: s.tl,
  };
}

/** Best area + bait: most coins, or (when the house waits on a fish) most of that fish. */
function bestFishing(s: S, t = town(s), want?: string, override?: Partial<Gear>): { gear: Gear; r: Rate } {
  const base = { ...baseGear(s, t), ...override };
  const baits: (string | undefined)[] = [undefined];
  if (shopOpen(s, 'baitShop')) for (const b of BAITS) if (s.tl >= b.unlockLevel) baits.push(b.id);
  const areas = override?.area ? [override.area] : [...s.areas];
  let top: { gear: Gear; r: Rate; score: number } | undefined;
  for (const area of areas) {
    for (const bait of baits) {
      const gear: Gear = { ...base, area, bait, keep: want };
      const r = rate(gear);
      // Wanted fish are kept, so count them at their sale value plus a big premium.
      const score = want ? (r.fishPerMin[want] ?? 0) * 1e6 + r.coinsPerMin : r.coinsPerMin;
      if (!top || score > top.score) top = { gear, r, score };
    }
  }
  return top!;
}

// ------------------------------------------------------------------ What the house needs next

function houseNeed(s: S) {
  return TOWN_LEVELS[s.tl + 1];
}

/** Fish the player is collecting right now: the house's, then building upgrades' (Lv 3+). */
function wantedFish(s: S): string | undefined {
  const need = houseNeed(s)?.fish;
  if (!need || (s.ice[need.fish] ?? 0) >= need.amount) return undefined;
  // Out of the line's reach? Then first the fish the Tackle Shop upgrade needs (for a longer line).
  const f = fishById[need.fish];
  const reach = 40 + 15 * s.up.line + AREAS[areaIndex[f.area]].lineBonus;
  const shop = s.bldgs.find((b) => b.type === 'tackleShop');
  if (f.minDepth + 15 > reach && shop && s.up.line >= shop.level * UPGRADES[0].levelsPerShopLevel) {
    const shopFish = upgradeFish(shop);
    if (shopFish && (s.ice[shopFish.fish] ?? 0) < shopFish.amount) return shopFish.fish;
  }
  return need.fish;
}

// ------------------------------------------------------------------ Purchases

interface Option {
  name: string;
  cost: number;
  gain: number; // coins/min
  fish?: { fish: string; amount: number };
  apply: () => void;
  force?: boolean; // needed to level up, buy as soon as affordable
  land?: boolean; // takes room in town
}

function tilesUsed(s: S): number {
  return s.bldgs.reduce((n, b) => n + def(b.type).w * def(b.type).h * (def(b.type).category === 'tile' ? 1 : A.tileOverhead), 0);
}
const tilesFree = (s: S) => (START_ROWS + s.expansions * ROWS_PER_EXPANSION) * TOWN_COLS - tilesUsed(s);

const buildCost = (s: S, type: string) => Math.round(def(type).baseCost * Math.pow(def(type).costGrowth, count(s, type)));
const countCap = (s: S, type: string) => {
  const d = def(type);
  return d.countAtLevel ? Math.min(d.maxCount, d.countAtLevel(s.tl)) : d.maxCount;
};
const unlocked = (s: S, type: string) => s.tl >= (def(type).unlockLevel ?? 1);

function upgradeFish(b: B): { fish: string; amount: number } | undefined {
  const to = b.level + 1;
  const d = def(b.type);
  if (to < 3 || d.category === 'decor' || d.category === 'tile') return undefined;
  return { fish: UPGRADE_FISH[d.unlockLevel ?? 1] ?? 'cod', amount: upgradeFishAmount(to) };
}

/** Coins/min of fishing + town while playing, net of wages, festival and bait. */
function activeIncome(s: S): number {
  const t = town(s);
  return bestFishing(s, t).r.coinsPerMin + t.gross - t.wages - festivalCostPerMin(s) + trickle(s);
}

/**
 * What the player plans with: coins per minute of play. The daily player also counts what the town
 * earns while they're away, spread over their minutes of play.
 */
function income(s: S): number {
  const active = activeIncome(s);
  if (profile !== 'daily') return active;
  return active + offlinePerDay(s) / (A.sessionMin * A.awayHours.length);
}

/** Quests, requests and orders, averaged per minute. */
function trickle(s: S): number {
  if (s.tl < QUESTS.unlockLevel) return 0;
  const tl = s.tl;
  const cap = 3 + s.up.capacity;
  const quest = (100 + cap * 15 * tl + 60 * Math.pow(tl, 1.5) + 84 + 80 * tl + 120 * tl) / 6;
  let v = quest / A.questEveryMin;
  v += (A.requestShare * REQUESTS.rewardPerLevel * tl) / (REQUESTS.everySeconds / 60);
  if (tl >= ORDERS.unlockLevel) v += (A.orderShare * ORDERS.payMultiplier * 6 * 15 * Math.sqrt(tl)) / (ORDERS.everySeconds / 60);
  return v;
}

/** Cheapest way to house `n` more residents. */
function housingPlan(s: S, n: number): { cost: number; steps: (() => void)[]; desc: string } {
  const sim = clone(s);
  let cost = 0;
  const steps: (() => void)[] = [];
  const names: string[] = [];
  let need = n;
  while (need > 0) {
    const opts: { cost: number; adds: number; name: string; act: (x: S) => void }[] = [];
    if (count(sim, 'cottage') < def('cottage').maxCount) {
      const c = buildCost(sim, 'cottage') + A.decorCostPerHome * sim.tl;
      opts.push({ cost: c, adds: def('cottage').housing!(1), name: 'Cottage', act: (x) => x.bldgs.push({ type: 'cottage', level: 1 }) });
    }
    if (unlocked(sim, 'apartment') && count(sim, 'apartment') < def('apartment').maxCount) {
      const c = buildCost(sim, 'apartment') + A.decorCostPerHome * sim.tl * 2;
      opts.push({ cost: c, adds: def('apartment').housing!(1), name: 'Apartment', act: (x) => x.bldgs.push({ type: 'apartment', level: 1 }) });
    }
    for (const type of ['cottage', 'apartment']) {
      const homes = sim.bldgs.filter((b) => b.type === type && b.level < Math.min(def(type).maxLevel, sim.tl));
      if (!homes.length) continue;
      const b = homes.reduce((a, c) => (c.level < a.level ? c : a));
      const fish = upgradeFish(b);
      if (!fishFree(sim, fish)) continue;
      const adds = def(type).housing!(b.level + 1) - def(type).housing!(b.level);
      opts.push({ cost: def(type).upgradeCost(b.level), adds, name: `${def(type).name} Lv${b.level + 1}`, act: (x) => {
        const y = x.bldgs.find((q) => q.type === type && q.level === b.level)!;
        if (fish) x.ice[fish.fish] = Math.max(0, (x.ice[fish.fish] ?? 0) - fish.amount);
        y.level++;
      } });
    }
    if (!opts.length) return { cost: Infinity, steps, desc: '' };
    // Cheapest per resident, but don't overbuild hugely for a small need.
    opts.sort((a, b) => a.cost / Math.min(a.adds, need) - b.cost / Math.min(b.adds, need));
    const o = opts[0];
    cost += o.cost;
    o.act(sim);
    steps.push(() => { /* replayed below */ });
    names.push(o.name);
    need -= o.adds;
    if (steps.length > 40) break;
  }
  // Re-run the same choices on the real state when applied.
  return { cost, steps: [() => applyHousing(s, n)], desc: names.join('+') };
}

function applyHousing(s: S, n: number) {
  let need = n;
  let guard = 0;
  while (need > 0 && guard++ < 40) {
    const before = housingCap(s);
    const plan = housingStep(s, need);
    if (!plan) break;
    plan.act(s); // paid for by the option that called this

    need -= housingCap(s) - before;
  }
}

function housingStep(s: S, need: number) {
  const opts: { cost: number; adds: number; act: (x: S) => void }[] = [];
  if (count(s, 'cottage') < def('cottage').maxCount) opts.push({ cost: buildCost(s, 'cottage') + A.decorCostPerHome * s.tl, adds: 2, act: (x) => x.bldgs.push({ type: 'cottage', level: 1 }) });
  if (unlocked(s, 'apartment') && count(s, 'apartment') < def('apartment').maxCount)
    opts.push({ cost: buildCost(s, 'apartment') + A.decorCostPerHome * s.tl * 2, adds: 6, act: (x) => x.bldgs.push({ type: 'apartment', level: 1 }) });
  for (const type of ['cottage', 'apartment']) {
    const homes = s.bldgs.filter((b) => b.type === type && b.level < Math.min(def(type).maxLevel, s.tl));
    if (!homes.length) continue;
    const b = homes.reduce((a, c) => (c.level < a.level ? c : a));
    const fish = upgradeFish(b);
    if (!fishFree(s, fish)) continue;
    opts.push({ cost: def(type).upgradeCost(b.level), adds: def(type).housing!(b.level + 1) - def(type).housing!(b.level), act: (x) => {
      if (fish) x.ice[fish.fish] = Math.max(0, (x.ice[fish.fish] ?? 0) - fish.amount);
      b.level++;
    } });
  }
  if (!opts.length) return undefined;
  opts.sort((a, b) => a.cost / Math.min(a.adds, need) - b.cost / Math.min(b.adds, need));
  return opts[0];
}

function clone(s: S): S {
  return { ...s, up: { ...s.up }, rods: new Set(s.rods), areas: new Set(s.areas), bldgs: s.bldgs.map((b) => ({ ...b })), ice: { ...s.ice }, log: [], gate: {}, levelAt: [], levelGate: [], incomeAt: [], fishingShare: [], srcAt: [], activeAt: [], townAt: [], src: { ...s.src } };
}

/** Income gain of a change, letting enough residents move in to staff the new jobs. */
function gainOf(s: S, change: (x: S) => void, extraWorkers = 0): number {
  const before = income(s);
  const x = clone(s);
  change(x);
  x.residents = Math.min(housingCap(x) + extraWorkers, Math.max(x.residents, Math.min(totalJobs(x), housingCap(x) + extraWorkers)));
  return income(x) - before;
}

/** Fish the player is saving for the house (or the Tackle Shop that leads to it): other upgrades leave it alone. */
let reservedFish: string | undefined;
function reserveFor(s: S): string | undefined {
  const need = houseNeed(s)?.fish;
  if (!need) return undefined;
  const f = fishById[need.fish];
  const reach = 40 + 15 * s.up.line + AREAS[areaIndex[f.area]].lineBonus;
  const shop = s.bldgs.find((b) => b.type === 'tackleShop');
  if (f.minDepth + 15 > reach && shop && s.up.line >= shop.level * UPGRADES[0].levelsPerShopLevel) return upgradeFish(shop)?.fish;
  return need.fish;
}
const fishFree = (s: S, need?: { fish: string; amount: number }) =>
  !need || (need.fish !== reservedFish && (s.ice[need.fish] ?? 0) >= need.amount);

function options(s: S): Option[] {
  reservedFish = reserveFor(s);
  const out: Option[] = [];
  const unemployed = Math.max(0, s.residents - totalJobs(s));
  const freeHousing = housingCap(s) - s.residents;

  // Fishing upgrades (Tackle Shop / Bait Shop), raising the shop's level when it caps them.
  for (const u of UPGRADES) {
    const lvl = s.up[u.id];
    if (lvl >= u.maxLevel) continue;
    const shopIdx = s.bldgs.findIndex((b) => b.type === u.shop);
    if (shopIdx < 0) continue;
    const shop = s.bldgs[shopIdx];
    let cost = upgradeCost(u, lvl);
    let fish: Option['fish'];
    const steps: ((x: S) => void)[] = [];
    if (lvl >= shop.level * u.levelsPerShopLevel) {
      if (shop.level >= Math.min(def(u.shop).maxLevel, s.tl)) continue;
      fish = upgradeFish(shop);
      if (fish && (s.ice[fish.fish] ?? 0) < fish.amount) continue;
      cost += def(u.shop).upgradeCost(shop.level);
      steps.push((x) => { x.bldgs.find((b) => b.type === u.shop)!.level++; if (fish) x.ice[fish.fish] = Math.max(0, (x.ice[fish.fish] ?? 0) - fish.amount); });
    }
    steps.push((x) => { x.up[u.id]++; });
    const name = `${u.name} ${lvl + 1}${steps.length > 1 ? ` (+${def(u.shop).name} Lv${shop.level + 1})` : ''}`;
    // The house waits on a fish the line can't reach yet: a longer line is a must.
    const gate = houseNeed(s)?.fish;
    const gateFish = gate && fishById[gate.fish];
    const reach = 40 + 15 * lvl + (gateFish ? AREAS[areaIndex[gateFish.area]].lineBonus : 0);
    const force = u.id === 'line' && !!gateFish && s.areas.has(gateFish.area) && (s.ice[gate.fish] ?? 0) < gate.amount && gateFish.minDepth + 15 > reach;
    out.push({ name, cost, gain: gainOf(s, (x) => steps.forEach((f) => f(x))), apply: () => steps.forEach((f) => f(s)), force });
  }

  // Rods and boats
  for (const r of C.RODS) {
    if (s.rods.has(r.id) || s.tl < r.unlockLevel) continue;
    out.push({ name: r.name, cost: r.cost, gain: gainOf(s, (x) => { x.rods.add(r.id); x.rod = r.id; }), apply: () => { s.rods.add(r.id); s.rod = r.id; } });
  }
  for (const a of AREAS) {
    if (s.areas.has(a.id) || s.tl < a.unlockLevel) continue;
    const needsYard = !s.bldgs.some((b) => b.type === 'boatyard');
    const cost = a.cost + (needsYard ? buildCost(s, 'boatyard') : 0);
    const add = (x: S) => { x.areas.add(a.id); if (needsYard) x.bldgs.push({ type: 'boatyard', level: 1 }); };
    const gate = houseNeed(s)?.fish;
    const force = !!gate && fishById[gate.fish].area === a.id;
    out.push({ name: `${a.boat}${needsYard ? ' (+Boatyard)' : ''}`, cost, gain: gainOf(s, add, needsYard ? 1 : 0), apply: () => add(s), force });
  }

  // Buildings: new ones and upgrades.
  for (const d of C.BUILDINGS) {
    if (!d.jobs && !d.landmark) continue;
    if (['boatyard', 'playerHouse'].includes(d.id)) continue;
    if (!unlocked(s, d.id)) continue;
    if (count(s, d.id) < countCap(s, d.id)) {
      const cost = buildCost(s, d.id);
      const jobs = d.jobs?.(1) ?? 0;
      const needHomes = Math.max(0, jobs - unemployed - freeHousing);
      const homes = needHomes > 0 ? housingPlan(s, needHomes) : { cost: 0, steps: [] as (() => void)[], desc: '' };
      const essential = (d.id === 'tackleShop') || (d.id === 'baitShop');
      const add = (x: S) => x.bldgs.push({ type: d.id, level: 1 });
      out.push({
        name: `${d.name}${homes.desc ? ` (+${homes.desc})` : ''}`,
        cost: cost + homes.cost,
        land: true,
        gain: essential ? 1e6 : gainOf(s, add, needHomes),
        apply: () => { homes.steps.forEach((f) => f()); add(s); },
      });
    }
    // Upgrade the lowest-level one of this type.
    const mine = s.bldgs.filter((b) => b.type === d.id && b.level < Math.min(d.maxLevel, s.tl));
    if (mine.length && !['tackleShop', 'baitShop'].includes(d.id)) {
      const b = mine.reduce((a, c) => (c.level < a.level ? c : a));
      const fish = upgradeFish(b);
      if (!fishFree(s, fish)) continue;
      const extra = Math.max(0, (d.jobs?.(b.level + 1) ?? 0) - (d.jobs?.(b.level) ?? 0));
      const needHomes = Math.max(0, extra - unemployed - freeHousing);
      const homes = needHomes > 0 ? housingPlan(s, needHomes) : { cost: 0, steps: [] as (() => void)[], desc: '' };
      const idx = s.bldgs.indexOf(b);
      const up = (x: S) => { x.bldgs[idx].level++; if (fish) x.ice[fish.fish] = Math.max(0, (x.ice[fish.fish] ?? 0) - fish.amount); };
      out.push({
        name: `${d.name} Lv${b.level + 1}${homes.desc ? ` (+${homes.desc})` : ''}`,
        cost: d.upgradeCost(b.level) + homes.cost,
        gain: gainOf(s, up, needHomes),
        apply: () => { homes.steps.forEach((f) => f()); up(s); },
      });
    }
  }
  // Town Square (festivals) once affordable.
  if (unlocked(s, 'townSquare') && !count(s, 'townSquare')) {
    const add = (x: S) => x.bldgs.push({ type: 'townSquare', level: 1 });
    out.push({ name: 'Town Square (festivals)', cost: buildCost(s, 'townSquare'), land: true, gain: gainOf(s, add), apply: () => add(s) });
  }
  // Housing for idle jobs.
  const openJobs = totalJobs(s) - s.residents - freeHousing;
  if (openJobs > 0) {
    const plan = housingPlan(s, Math.min(openJobs, 6));
    out.push({ name: `Homes for workers (${plan.desc})`, cost: plan.cost, land: true, gain: gainOf(s, (x) => { for (let i = 0; i < Math.min(openJobs, 6); i++) x.bldgs.push({ type: 'cottage', level: 1 }); }) / 2, apply: plan.steps[0] });
  }
  // Housing the house upgrade needs.
  const need = houseNeed(s);
  if (need && housingCap(s) < need.residents) {
    const plan = housingPlan(s, need.residents - housingCap(s));
    out.push({ name: `Homes for Lv${s.tl + 1} (${plan.desc})`, cost: plan.cost, gain: 0, apply: plan.steps[0], force: true });
  }
  // Land
  return out.filter((o) => isFinite(o.cost));
}

// ------------------------------------------------------------------ Main loop

function step(s: S): void {
  // Keep a festival going only while it pays.
  if (s.bldgs.some((b) => b.type === 'townSquare')) {
    s.festOn = true;
    const withFest = activeIncome(s);
    s.festOn = false;
    s.festOn = withFest > activeIncome(s);
  }
  const t = town(s);
  const want = wantedFish(s);
  const { gear } = bestFishing(s, t, want);
  const c = cast(gear);
  const mins = c.seconds / 60;
  s.t += c.seconds;
  s.real += c.seconds;
  const bait = BAITS.find((b) => b.id === gear.bait);
  const fished = c.coins - (bait ? bait.packCost / bait.packSize : 0);
  s.coins += fished;
  s.src.fishing += fished;
  if (c.legend && !s.log.some((l) => l.includes(`legend:${gear.area}`))) {
    s.trophies++;
    s.log.push(`${fmtT(s.real)} legend:${gear.area}`);
  }
  // Keep fish needed for the house, and some Cod/Salmon/Tuna/Anglerfish for building upgrades.
  for (const [id, n] of Object.entries(c.fish)) {
    // Stock for building upgrades to Lv 3+, once the town level allows them (barrels hold 50).
    // Enough for one upgrade to the current town level (Icehouse assumed big enough).
    const forLv = (from: number) => (s.tl >= Math.max(3, from) ? upgradeFishAmount(s.tl) : 0);
    const keepFor = { cod: forLv(2), salmon: forLv(3), tuna: forLv(5), angler: forLv(6) } as Record<string, number>;
    const houseFish = houseNeed(s)?.fish;
    const limit = (houseFish?.fish === id ? houseFish.amount : 0) + (keepFor[id] ?? 0);
    const have = s.ice[id] ?? 0;
    const keep = Math.max(0, Math.min(n, limit - have));
    if (keep > 0) {
      s.ice[id] = have + keep;
      if (id !== gear.keep) {
        const unsold = keep * fishById[id].value * A.dailyPrice * gear.priceMult; // didn't sell them
        s.coins -= unsold;
        s.src.fishing -= unsold;
      }
    }
  }
  // Passive
  const passive = (t.gross - t.wages - festivalCostPerMin(s) + trickle(s)) * mins;
  s.coins += passive;
  s.src.town += passive;
  if (s.tl >= ORDERS.unlockLevel) s.orderDeliveries += (A.orderShare * mins) / (ORDERS.everySeconds / 60);
  // Move-ins
  const cap = housingCap(s);
  if (s.residents < cap) {
    const mult = scale(t.happiness, HAPPINESS.moveInAtZero, HAPPINESS.moveInAtFull) * (festivalOn(s) ? FESTIVAL.moveIn : 1);
    moveIns(s, c.seconds * mult);
  } else s.moveTimer = 0;

  // House upgrade?
  const need = houseNeed(s);
  if (need) {
    const fishOk = !need.fish || (s.ice[need.fish.fish] ?? 0) >= need.fish.amount;
    const resOk = s.residents >= need.residents;
    const coinOk = s.coins >= need.cost;
    if (fishOk && resOk && coinOk) {
      s.coins -= need.cost;
      if (need.fish) s.ice[need.fish.fish] -= need.fish.amount;
      s.tl++;
      s.bldgs[0].level = s.tl;
      s.levelAt[s.tl] = s.real;
      s.activeAt[s.tl] = s.t;
      s.srcAt[s.tl] = { ...s.src };
      const t0 = town(s, false);
      s.townAt[s.tl] = { gross: t0.gross, wages: t0.wages };
      // Income at the moment of reaching the level (before spending on it).
      s.incomeAt[s.tl] = income(s);
      s.fishingShare[s.tl] = bestFishing(s).r.coinsPerMin / s.incomeAt[s.tl];
      if (opt('options', 0) === s.tl) {
        // Debug: what the player could buy on arrival, best payback first.
        for (const o of options(s).sort((a, b) => a.cost / a.gain - b.cost / b.gain)) {
          s.log.push(`   option ${o.name}: $${Math.round(o.cost)}, +$${o.gain.toFixed(0)}/min${o.force ? ' (needed)' : ''}`);
        }
      }
      s.log.push(`${fmtT(s.real)} ==== Town level ${s.tl} ====`);
      return;
    }
    // What's holding it back right now (several can apply).
    const g = (s.levelGate[s.tl + 1] ??= {});
    const add = (k: string) => (g[k] = (g[k] ?? 0) + c.seconds);
    if (!coinOk) add('coins');
    if (!resOk) add('residents');
    if (!fishOk) add('fish');
  }

  if (flag('trace') && Math.floor(s.t / 60) !== Math.floor((s.t - c.seconds) / 60)) {
    s.log.push(`${fmtT(s.real)} coins $${Math.round(s.coins)}, income $${income(s).toFixed(0)}/min, residents ${s.residents}/${housingCap(s)}, jobs ${totalJobs(s)}, line ${s.up.line}, want ${wantedFish(s) ?? '-'} (${s.ice[wantedFish(s) ?? ''] ?? 0}), ${bestFishing(s, town(s), wantedFish(s)).gear.area}/${bestFishing(s, town(s), wantedFish(s)).gear.bait}`);
  }
  // Shopping: forced needs first, then the best payback while it doesn't delay the house much.
  for (let guard = 0; guard < 6; guard++) {
    const opts = options(s);
    const forced = opts.filter((o) => o.force).sort((a, b) => a.cost - b.cost)[0];
    const inc = Math.max(1, income(s));
    const toHouse = need ? Math.max(0, need.cost - s.coins) / inc : 60;
    const good = opts
      .filter((o) => !o.force && o.gain > 0)
      .map((o) => ({ o, payback: o.cost / o.gain }))
      .sort((a, b) => a.payback - b.payback)[0];
    // A quick win (pays back within 5 min) comes before what the house needs; then the house's needs.
    if (forced) {
      if (s.coins >= forced.cost) { buy(s, forced); continue; }
      // Short of money for it: only quick wins that don't push it further away.
      if (!good || good.payback > 5 || s.coins - good.o.cost < 0) break;
    }
    if (!good) break;
    // New buildings need room: keep the next land expansion's price in hand once the town is nearly full.
    if (good.o.land && tilesFree(s) < 40 && s.coins < good.o.cost + expansionCost(s.expansions)) break;
    // Worth it if it pays for itself before the house upgrade would be affordable anyway (or soon).
    const limit = Math.max(5, toHouse + good.o.cost / inc);
    if (good.payback > limit) break;
    if (s.coins < good.o.cost) break;
    buy(s, good.o);
  }
  // Land when the town is (nearly) full.
  if (tilesFree(s) < 40 && s.coins >= expansionCost(s.expansions)) {
    const cost = expansionCost(s.expansions);
    s.coins -= cost;
    s.expansions++;
    s.log.push(`${fmtT(s.real)} land expansion $${cost}`);
  }
}

function moveIns(s: S, seconds: number) {
  const cap = housingCap(s);
  s.moveTimer += seconds;
  while (s.residents < cap) {
    const wait = s.residents === 0 ? FIRST_MOVE_IN_SECONDS : K.MOVE_IN_SECONDS;
    if (s.moveTimer < wait) break;
    s.moveTimer -= wait;
    s.residents++;
  }
  if (s.residents >= cap) s.moveTimer = 0;
}

/** The daily player closes the game for `hours`: paid like economy.ts does for a long gap. */
function goAway(s: S, hours: number) {
  s.away = true;
  const t = town(s, false);
  const effMin = Math.min(hours, t.offlineCap) * 60;
  const earned = Math.max(-s.coins, offlinePerMin(s, t) * effMin);
  s.coins += earned;
  s.src.offline += earned;
  // Move-ins run on the capped time too (no festival).
  if (s.residents < housingCap(s)) moveIns(s, effMin * 60 * scale(t.happiness, HAPPINESS.moveInAtZero, HAPPINESS.moveInAtFull));
  // Up to 3 orders wait for the player's return.
  if (s.tl >= ORDERS.unlockLevel) s.orderDeliveries += A.orderShare * Math.min(ORDERS.max, effMin / (ORDERS.everySeconds / 60));
  // What the house was waiting on while away.
  const need = houseNeed(s);
  if (need) {
    const g = (s.levelGate[s.tl + 1] ??= {});
    const add = (k: string) => (g[k] = (g[k] ?? 0) + hours * 3600);
    if (s.coins < need.cost) add('coins');
    if (s.residents < need.residents) add('residents');
    if (need.fish && (s.ice[need.fish.fish] ?? 0) < need.fish.amount) add('fish');
  }
  s.real += hours * 3600;
  s.away = false;
}

function buy(s: S, o: Option) {
  s.coins -= o.cost;
  o.apply();
  s.log.push(`${fmtT(s.real)} buy ${o.name} $${Math.round(o.cost)}${o.gain > 0 && o.gain < 1e5 ? ` (+$${o.gain.toFixed(1)}/min)` : ''}`);
}

const fmtT = (sec: number) => {
  const m = Math.round(sec / 60);
  if (m >= 1440) return `d${Math.floor(m / 1440) + 1} ${Math.floor((m % 1440) / 60)}h${String(m % 60).padStart(2, '0')}`;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
};

function run(seedValue: number): S {
  seed = seedValue;
  const s = newState();
  if (profile === 'grinder') {
    while (s.tl < 10 && s.t < A.maxHours * 3600) step(s);
    return s;
  }
  while (s.tl < 10 && s.real < A.maxDays * 86400) {
    for (const hours of A.awayHours) {
      const end = s.t + A.sessionMin * 60;
      while (s.tl < 10 && s.t < end) step(s);
      if (s.tl >= 10) break;
      goAway(s, hours);
    }
  }
  return s;
}

// ------------------------------------------------------------------ Report

if (flag('rates')) {
  // Fishing coins/min in the Harbor for a few gear setups (no town bonuses, Lv 1 prices).
  console.log('| Line | Hook | Reel | coins/min | from Old Barnacle |');
  console.log('|---|---|---|---|---|');
  for (const [line, cap, reel] of [[0, 0, 0], [2, 1, 1], [4, 4, 2], [6, 4, 4], [8, 6, 4], [8, 8, 6], [12, 10, 8], [16, 12, 10]]) {
    const st = { lineLength: 40, capacity: 3, shields: 0, descentSpeed: 7, ascentSpeed: 9 };
    UPGRADES[0].apply(st as any, line); UPGRADES[1].apply(st as any, cap); UPGRADES[2].apply(st as any, reel);
    const g: Gear = { area: 'harbor', line: st.lineLength, cap: st.capacity, shields: 0, ds: st.descentSpeed, as: st.ascentSpeed, rod: 'classic', priceMult: 1, tl: 1 };
    const r = rate(g);
    const chance = LEGENDARY.chance;
    (LEGENDARY as any).chance = 0; rateCache.clear();
    const r0 = rate(g);
    (LEGENDARY as any).chance = chance; rateCache.clear();
    console.log(`| ${st.lineLength} m | ${st.capacity} | ${st.descentSpeed.toFixed(1)} m/s | ${r.coinsPerMin.toFixed(0)} | ${(100 * (1 - r0.coinsPerMin / r.coinsPerMin)).toFixed(0)}% |`);
  }
  process.exit(0);
}

const seeds = opt('seeds', 20);
const median = (xs: number[]) => {
  const a = xs.filter((x) => isFinite(x)).sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : NaN;
};
const f = (sec: number) => {
  if (isNaN(sec)) return '—';
  const m = sec / 60;
  return m >= 36 * 60 ? `${(m / 1440).toFixed(1)} d` : m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(0)} min`;
};
const pct = (v: number) => `${Math.round(100 * v)}%`;
const argProfile = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : undefined;

for (const p of PROFILES) {
  if (argProfile && argProfile !== p) continue;
  profile = p;
  rateCache.clear();
  const runs: S[] = [];
  for (let i = 0; i < seeds; i++) runs.push(run(1000 + i * 7919));
  const what = p === 'daily'
    ? `daily player: ${A.awayHours.length} × ${A.sessionMin} min sessions a day, away ${A.awayHours.join(' h / ')} h`
    : 'grinder: fishing non-stop, never away';
  console.log(`\n### ${what} (median of ${seeds} runs)\n`);
  console.log(`| Level | Reached at | Time in level | × previous | Active play in level | Coins: fishing / town (playing) / offline | Town on arrival (wages) |${flag('gates') ? ' Waited on |' : ''}`);
  console.log(`|---|---|---|---|---|---|---|${flag('gates') ? '---|' : ''}`);
  let prevSpan = NaN;
  for (let lv = 2; lv <= 10; lv++) {
    const at = median(runs.map((r) => r.levelAt[lv] ?? Infinity));
    const span = median(runs.map((r) => (r.levelAt[lv] ?? Infinity) - (r.levelAt[lv - 1] ?? Infinity)));
    const active = median(runs.map((r) => (r.activeAt[lv] ?? Infinity) - (r.activeAt[lv - 1] ?? Infinity)));
    const gates: Record<string, number> = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.levelGate[lv] ?? {})) gates[k] = (gates[k] ?? 0) + v;
    const total = Object.values(gates).reduce((a, b) => a + b, 0) || 1;
    // Coins earned during the level, by source (summed over runs that got there).
    const sum = { fishing: 0, town: 0, offline: 0 };
    for (const r of runs) {
      const a = r.srcAt[lv - 1];
      const b = r.srcAt[lv];
      if (!a || !b) continue;
      for (const k of ['fishing', 'town', 'offline'] as const) sum[k] += b[k] - a[k];
    }
    const all = sum.fishing + sum.town + sum.offline || 1;
    const gross = median(runs.map((r) => r.townAt[lv]?.gross ?? NaN));
    const wages = median(runs.map((r) => r.townAt[lv]?.wages ?? NaN));
    const ratio = span / prevSpan;
    const gate = Object.entries(gates).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / total)}%`).join(', ');
    console.log(`| ${lv - 1} → ${lv} | ${f(at)} | ${f(span)} | ${isFinite(ratio) ? ratio.toFixed(2) : '—'} | ${f(active)} | ${pct(sum.fishing / all)} / ${pct(sum.town / all)} / ${pct(sum.offline / all)} | $${Math.round(gross).toLocaleString('en-US')}/min (${isFinite(wages / gross) ? pct(wages / gross) : '—'}) |${flag('gates') ? ` ${gate} |` : ''}`);
    prevSpan = span;
  }
  const reached = runs.filter((r) => r.tl >= 10).length;
  console.log(`\n${reached}/${seeds} runs reached level 10${p === 'daily' ? ` within ${A.maxDays} days` : ` within ${A.maxHours} h of play`}.`);
  if (flag('log')) {
    console.log('\nRun 1 log:');
    for (const l of runs[0].log) console.log('  ' + l);
  }
}
