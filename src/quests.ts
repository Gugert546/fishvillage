// Quest board: a few small goals at a time, always ones the player can actually reach right now.

import { AREA_BY_ID, BAITS, BUILDINGS, BUILDING_BY_ID, FISH, QUESTS, type BuildingId, type FishType } from './config';
import { townHappiness } from './happiness';
import { housingCapacity } from './population';
import { hookBonus } from './services';
import { fishingStats, save, state, type Quest, type QuestKind } from './state';
import { baitUnlocked, isUnlocked, levelCap, ownsArea, townLevel } from './town';
import { dayKey, fishOfTheDay } from './world';

type Draft = Omit<Quest, 'id' | 'progress' | 'done' | 'reward'> & { coins: number };

const pick = <T>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

/** Fisher–Yates shuffle (sorting with a random comparator is biased). */
function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);
/** "1 Bench", "3 Benches", "2 Trees". */
const plural = (n: number, word: string) => {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word}${/(s|x|ch|sh)$/i.test(word) ? 'es' : 's'}`;
};

export function questsUnlocked(): boolean {
  return townLevel() >= QUESTS.unlockLevel;
}

export function swapCost(): number {
  return QUESTS.swapCostPerLevel * townLevel();
}

// ---------------------------------------------------------------- Generators
// Each returns a quest that's possible right now, or undefined if this kind doesn't fit yet.

/** Deepest point the hook can reach in a fish's area, in metres (some boats add line). */
const reach = (f: FishType) => fishingStats().lineLength + AREA_BY_ID[f.area].lineBonus;
/** How many of each fish feels like a fair ask: lots of cheap ones, a couple of pricey ones. */
const fishAsk = (f: FishType) => (f.value <= 3 ? 8 : f.value <= 6 ? 6 : f.value <= 15 ? 5 : f.value <= 40 ? 4 : f.value <= 100 ? 3 : 2);

const GENERATORS: Record<QuestKind, () => Draft | undefined> = {
  catchFish: () => {
    // Only fish in areas you can sail to, living comfortably within the line's reach.
    const fish = pick(FISH.filter((f) => !f.legendary && ownsArea(AREA_BY_ID[f.area]) && f.minDepth + 5 <= reach(f)));
    if (!fish) return undefined;
    const amount = fishAsk(fish);
    return { kind: 'catchFish', target: fish.id, amount, coins: roundTo(amount * fish.value * 3 + 20, 5) };
  },
  fillHook: () => {
    const amount = fishingStats().capacity + hookBonus();
    return { kind: 'fillHook', amount, coins: roundTo(amount * 15 * townLevel(), 5) };
  },
  earnFishing: () => {
    const amount = roundTo(120 * Math.pow(townLevel(), 1.5), 10);
    return { kind: 'earnFishing', amount, coins: roundTo(amount * 0.5, 5) };
  },
  placeDecor: () => {
    const def = pick(BUILDINGS.filter((d) => d.category === 'decor' && isUnlocked(d) && d.w === 1));
    if (!def) return undefined;
    const amount = 2 + Math.floor(Math.random() * 3);
    return { kind: 'placeDecor', target: def.id, amount, coins: roundTo(def.baseCost * amount * 1.6, 5) };
  },
  buildRoads: () => {
    const amount = roundTo(8 + Math.random() * 12, 2);
    return { kind: 'buildRoads', amount, coins: roundTo(amount * 6, 5) };
  },
  upgrade: () => {
    // A building you own that can still go up a level within the town level cap.
    const options = state.buildings.filter((b) => b.type !== 'playerHouse' && b.level < levelCap(b));
    const b = pick(options);
    if (!b) return undefined;
    const def = BUILDING_BY_ID[b.type];
    const best = Math.max(...state.buildings.filter((x) => x.type === b.type).map((x) => x.level));
    const amount = Math.min(best + 1, levelCap(b));
    if (amount <= best) return undefined;
    return { kind: 'upgrade', target: b.type, amount, coins: roundTo(def.upgradeCost(amount - 1) * 0.5 + 30, 5) };
  },
  residents: () => {
    const now = state.residents.length;
    const amount = now + 3 + Math.floor(Math.random() * 4);
    // Needs room to grow into, or at least a reason to build homes.
    if (amount > housingCapacity() + 12) return undefined;
    return { kind: 'residents', amount, coins: roundTo(80 * townLevel(), 5) };
  },
  happiness: () => {
    const now = townHappiness();
    if (now === null || now >= 85) return undefined;
    const amount = Math.min(90, roundTo(now + 10, 5));
    return { kind: 'happiness', amount, coins: roundTo(120 * townLevel(), 5) };
  },
};

/** A fresh quest, avoiding duplicates on the board and (if possible) the kind just finished. */
function newQuest(avoid?: QuestKind): Quest | undefined {
  const taken = new Set(state.quests.map((q) => `${q.kind}:${q.target ?? ''}`));
  const shuffled = shuffle(Object.keys(GENERATORS) as QuestKind[]);
  // Try the avoided kind last, so it only comes back when nothing else fits.
  const kinds = [...shuffled.filter((k) => k !== avoid), ...shuffled.filter((k) => k === avoid)];
  for (const kind of kinds) {
    const draft = GENERATORS[kind]();
    if (!draft || taken.has(`${draft.kind}:${draft.target ?? ''}`)) continue;
    const { coins, ...rest } = draft;
    const reward: Quest['reward'] = { coins };
    const bait = [...BAITS].reverse().find(baitUnlocked);
    if (bait && Math.random() < QUESTS.baitRewardChance) reward.bait = { id: bait.id, count: 3 };
    return { ...rest, id: state.nextQuestId++, progress: 0, done: false, reward };
  }
  return undefined;
}

/** Posts today's daily quest (catch some of the fish of the day), replacing yesterday's. */
function ensureDaily(): boolean {
  const today = dayKey();
  if (state.dailyDate === today) return false;
  state.dailyDate = today;
  state.quests = state.quests.filter((q) => !q.daily);
  const fish = fishOfTheDay();
  const amount = Math.ceil(fishAsk(fish) * 1.5);
  const bait = [...BAITS].reverse().find(baitUnlocked);
  state.quests.unshift({
    id: state.nextQuestId++,
    kind: 'catchFish',
    target: fish.id,
    amount,
    progress: 0,
    done: false,
    daily: true,
    reward: { coins: roundTo(fish.value * amount * 6 + 150 * townLevel(), 5), bait: bait && { id: bait.id, count: 5 } },
  });
  return true;
}

/** Tops the board up to the active count once quests are unlocked. */
export function ensureQuests(avoid?: QuestKind): void {
  if (!questsUnlocked()) return;
  let added = ensureDaily();
  while (state.quests.filter((q) => !q.daily).length < QUESTS.active) {
    const q = newQuest(avoid);
    if (!q) break;
    state.quests.push(q);
    added = true;
  }
  if (added) save();
}

// ------------------------------------------------------------------ Progress

/** Current progress toward `amount` (event-counted quests use the stored value). */
export function questProgress(q: Quest): number {
  switch (q.kind) {
    case 'upgrade':
      return Math.max(0, ...state.buildings.filter((b) => b.type === q.target).map((b) => b.level));
    case 'residents':
      return state.residents.length;
    case 'happiness':
      return Math.floor(townHappiness() ?? 0);
    default:
      return q.progress;
  }
}

let toasts: string[] = [];

/** Adds a message for the next scene update to show (quests, orders…). */
export function queueToast(message: string): void {
  toasts.push(message);
}

/** "Quest complete" (and other) messages waiting to be shown. */
export function takeQuestToasts(): string[] {
  const out = toasts;
  toasts = [];
  return out;
}

function markDoneIfReached(q: Quest): void {
  if (q.done || questProgress(q) < q.amount) return;
  q.done = true;
  toasts.push(`Quest complete: ${describeQuest(q)}`);
}

/** Re-checks quests that depend on the town's state (levels, population, happiness). */
export function checkQuests(): void {
  ensureQuests();
  for (const q of state.quests) markDoneIfReached(q);
}

export type QuestEvent =
  | { type: 'cast'; fish: string[] }
  | { type: 'sold'; coins: number }
  | { type: 'placed'; building: BuildingId };

export function questEvent(e: QuestEvent): void {
  for (const q of state.quests) {
    if (q.done) continue;
    if (e.type === 'cast') {
      if (q.kind === 'catchFish') q.progress += e.fish.filter((id) => id === q.target).length;
      if (q.kind === 'fillHook') q.progress = Math.max(q.progress, e.fish.length);
    } else if (e.type === 'sold') {
      if (q.kind === 'earnFishing') q.progress += e.coins;
    } else {
      if (q.kind === 'placeDecor' && e.building === q.target) q.progress++;
      if (q.kind === 'buildRoads' && e.building === 'road') q.progress++;
    }
    q.progress = Math.min(q.progress, q.amount);
    markDoneIfReached(q);
  }
}

// ------------------------------------------------------------------- Actions

export function claimQuest(q: Quest): boolean {
  if (!q.done) return false;
  state.coins += q.reward.coins;
  if (q.reward.bait) state.bait[q.reward.bait.id] = (state.bait[q.reward.bait.id] ?? 0) + q.reward.bait.count;
  state.quests = state.quests.filter((x) => x !== q);
  ensureQuests(q.kind);
  save();
  return true;
}

/** Throws a quest away for a new one, for a small fee. */
export function swapQuest(q: Quest): boolean {
  if (q.done || q.daily || state.coins < swapCost()) return false;
  state.coins -= swapCost();
  const i = state.quests.indexOf(q);
  state.quests.splice(i, 1);
  const next = newQuest(q.kind);
  if (next) state.quests.splice(i, 0, next);
  save();
  return true;
}

export function describeQuest(q: Quest): string {
  const fishType = FISH.find((f) => f.id === q.target);
  const fish = fishType ? `${fishType.name}${fishType.area === 'harbor' ? '' : ` (${AREA_BY_ID[fishType.area].name})`}` : 'fish';
  const building = q.target ? BUILDING_BY_ID[q.target as BuildingId]?.name : '';
  switch (q.kind) {
    case 'catchFish':
      return `${q.daily ? 'Daily: ' : ''}Catch ${q.amount} ${fish}`;
    case 'fillHook':
      return `Catch ${q.amount} fish in one cast`;
    case 'earnFishing':
      return `Earn $${q.amount} selling fish`;
    case 'placeDecor':
      return `Place ${plural(q.amount, building ?? 'decoration')}`;
    case 'buildRoads':
      return `Build ${q.amount} road tiles`;
    case 'upgrade':
      return `Upgrade a ${building} to Lv ${q.amount}`;
    case 'residents':
      return `Reach ${q.amount} residents`;
    case 'happiness':
      return `Reach ${q.amount}% happiness`;
  }
}
