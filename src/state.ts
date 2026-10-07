import { BASE_STATS, UPGRADES, type BuildingId, type FishingStats, type UpgradeId } from './config';

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
}

export interface Resident {
  id: number;
  name: string;
  /** Building id of their home. */
  home: number;
  /** Building id of their workplace, or null if unemployed. */
  job: number | null;
}

export interface GameState {
  version: number;
  /** Can be fractional while passive income trickles in; display with Math.floor. */
  coins: number;
  upgrades: Record<UpgradeId, number>;
  /** Total caught per fish id, for the future aquarium/collection. */
  caught: Record<string, number>;
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
    }
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  return state;
}

export const state: GameState = load();

export function save(): void {
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
  return stats;
}
