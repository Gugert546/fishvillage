import {
  BASE_STATS,
  UPGRADES,
  type AreaId,
  type BaitId,
  type BuildingId,
  type CharmId,
  type FishingStats,
  type MerchantItemId,
  type PerkId,
  type RodId,
  type ProjectId,
  type UpgradeId,
} from './config';

const SAVE_KEY = 'fishvillage.save.v1';
const SAVE_VERSION = 2;

export interface PlacedBuilding {
  id: number;
  type: BuildingId;
  /** Grid position of the bottom-left tile; rows count upward from the dock. */
  col: number;
  row: number;
  level: number;
  /** Coins spent on building + upgrading it, for sell refunds. Missing in old saves. */
  spent?: number;
  /** Workplaces: how many workers the player wants here; undefined = as many as fit. */
  staff?: number;
  /** Workplaces: filled before other workplaces. */
  priority?: boolean;
  /** Orders this building has received; each one raises its income for good. */
  deliveries?: number;
}

/** A building asking for fish from the Icehouse. */
export interface Order {
  id: number;
  /** Building id that ordered. */
  building: number;
  fish: string;
  amount: number;
  coins: number;
}

export interface Resident {
  id: number;
  name: string;
  /** Building id of their home. */
  home: number;
  /** Building id of their workplace, or null if unemployed. */
  job: number | null;
  /** The player chose this job (or no job) by hand; auto-assignment leaves it alone. */
  pinned?: boolean;
  /** Lasting happiness from requests you fulfilled for them. */
  cheer?: number;
}

/** Something a resident would love: a decoration near home, a road by the door, a certain job. */
export interface Request {
  id: number;
  resident: number;
  kind: 'decor' | 'road' | 'job';
  /** Decoration or workplace type, for 'decor' and 'job'. */
  target?: BuildingId;
  coins: number;
}

export type QuestKind =
  | 'catchFish'
  | 'fillHook'
  | 'earnFishing'
  | 'placeDecor'
  | 'buildRoads'
  | 'upgrade'
  | 'residents'
  | 'happiness';

export interface Quest {
  id: number;
  kind: QuestKind;
  /** Fish id or building id the quest is about, if any. */
  target?: string;
  /** How many/much is needed (count, coins, level, residents or happiness %). */
  amount: number;
  /** Progress for quests counted from events (catches, placements, earnings). */
  progress: number;
  reward: { coins: number; bait?: { id: BaitId; count: number } };
  done: boolean;
  /** Today's special quest: bigger reward, can't be swapped, replaced at midnight. */
  daily?: boolean;
}

export interface GameState {
  version: number;
  /** Can be fractional while passive income trickles in; display with Math.floor. */
  coins: number;
  upgrades: Record<UpgradeId, number>;
  /** Total caught per fish id, for the future aquarium/collection. */
  caught: Record<string, number>;
  /** Bait owned, per kind. */
  bait: Partial<Record<BaitId, number>>;
  /** Bait to use on the next cast, or null for none. */
  selectedBait: BaitId | null;
  quests: Quest[];
  nextQuestId: number;
  /** Fish kept on ice, per fish id. */
  crates: Record<string, number>;
  orders: Order[];
  nextOrderId: number;
  /** Seconds accumulated toward the next order. */
  orderTimer: number;
  requests: Request[];
  nextRequestId: number;
  /** Seconds accumulated toward the next resident request. */
  requestTimer: number;
  /** Fish the Fishing Wharf's boats brought in, waiting for the Cannery. */
  wharfHold: Record<string, number>;
  /** Seconds the fleet has been at sea (drives each boat's trips). */
  fleetClock: number;
  /** Canned fish waiting for a trade ship, and what they're worth together. */
  cans: number;
  cansValue: number;
  /** Fraction of the next can the Cannery is working on. */
  canProgress: number;
  /** Seconds accumulated toward the next trade ship. */
  shipTimer: number;
  /** Ranks bought in each perk. */
  perks: Partial<Record<PerkId, number>>;
  /** Perk points already announced, so new ones get a toast. */
  perkPointsSeen: number;
  /** Landmarks ever built (each is a perk point, even if moved or sold). */
  landmarks: string[];
  /** devFree: dev builds only, free mode for playtesting (on unless switched off). */
  settings: { sound: boolean; music: boolean; devFree?: boolean };
  /** The festival going on right now (until a wall-clock time), if any. */
  festival: { until: number; name: string } | null;
  /** Merchant boosts left, in casts. */
  charms: Partial<Record<CharmId, number>>;
  /** Everything ever bought from the merchant (merchant decor can be placed this many times). */
  merchantBought: Partial<Record<MerchantItemId, number>>;
  /** The merchant visit you shopped at, and what you bought there (one of each per visit). */
  merchantVisit: { slot: number; bought: MerchantItemId[] };
  /** Last merchant visit announced with a toast. */
  merchantSeen: number;
  /** Coins put into each town project so far. */
  projects: Partial<Record<ProjectId, number>>;
  /** The daily quest's date ("2026-10-08"); a new one is posted when the day changes. */
  dailyDate: string;
  /** Rods bought at the Tackle Shop, and the one in use. */
  rods: RodId[];
  rod: RodId;
  /** Areas where a bottle's message says the legendary will be waiting on your next cast. */
  legendHints: AreaId[];
  /** Fishing areas you own a boat for (the Harbor needs none). */
  boats: AreaId[];
  /** Where you fish right now. */
  area: AreaId;
  buildings: PlacedBuilding[];
  residents: Resident[];
  /** Seconds accumulated toward the next resident moving in. */
  moveInTimer: number;
  expansions: number;
  nextBuildingId: number;
  nextResidentId: number;
  lastSaved: number;
}

function freshState(): GameState {
  return {
    version: SAVE_VERSION,
    coins: 0,
    upgrades: { line: 0, capacity: 0, shield: 0, reel: 0 },
    caught: {},
    bait: {},
    selectedBait: null,
    quests: [],
    nextQuestId: 1,
    crates: {},
    orders: [],
    nextOrderId: 1,
    orderTimer: 0,
    requests: [],
    nextRequestId: 1,
    requestTimer: 0,
    wharfHold: {},
    fleetClock: 0,
    cans: 0,
    cansValue: 0,
    canProgress: 0,
    shipTimer: 0,
    perks: {},
    perkPointsSeen: -1,
    landmarks: [],
    settings: { sound: true, music: true },
    festival: null,
    charms: {},
    merchantBought: {},
    merchantVisit: { slot: -1, bought: [] },
    merchantSeen: -1,
    projects: {},
    dailyDate: '',
    rods: ['classic'],
    rod: 'classic',
    legendHints: [],
    boats: [],
    area: 'harbor',
    buildings: [],
    residents: [],
    moveInTimer: 0,
    expansions: 0,
    nextBuildingId: 1,
    nextResidentId: 1,
    lastSaved: Date.now(),
  };
}

/** True when this save came from before residents existed and needs starter residents. */
export let needsStarterResidents = false;

function migrate(saved: Partial<GameState>): void {
  const version = saved.version ?? 1;
  if (version < 2) {
    // v2 halved the tile size: same buildings, twice the footprint in tiles.
    for (const b of saved.buildings ?? []) {
      b.col *= 2;
      b.row *= 2;
    }
    needsStarterResidents = (saved.buildings?.length ?? 0) > 0;
  }
  saved.version = SAVE_VERSION;
}

function load(): GameState {
  const state = freshState();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<GameState>;
      migrate(saved);
      // Merge so new fields added later get their defaults.
      Object.assign(state, saved);
      state.upgrades = { ...freshState().upgrades, ...saved.upgrades };
      state.settings = { ...freshState().settings, ...saved.settings };
    }
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  return state;
}

export const state: GameState = load();

/** Set while wiping the save, so nothing (e.g. the hide-on-reload autosave) writes it back. */
let resetting = false;

export function save(): void {
  if (resetting) return;
  state.lastSaved = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode etc.); progress lives for this session only.
  }
}

export function fishingStats(): FishingStats {
  const stats = { ...BASE_STATS };
  for (const def of UPGRADES) def.apply(stats, state.upgrades[def.id]);
  // Fishing perks (ranks read straight from the save to keep this module dependency-free).
  const rank = (id: PerkId) => state.perks[id] ?? 0;
  stats.capacity += rank('bigBucket');
  stats.shields += rank('steadyHands');
  stats.descentSpeed *= 1 + 0.1 * rank('quickReel');
  stats.ascentSpeed *= 1 + 0.1 * rank('quickReel');
  return stats;
}

/** Deletes the save and restarts the game from scratch. */
export function resetGame(): void {
  resetting = true;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
  location.reload();
}
