// The Antique Shop: junk from your casts waits there, and the appraiser pays by its condition.
// Most of it is worthless, a little is worth a bit, and once in a long while it's a treasure.

import { AREAS, ITEMS, JUNK, JUNK_KINDS, type AreaId, type JunkId, type JunkTier } from './config';
import { defOf, workerCounts } from './population';
import { save, state, type GameState, type PlacedBuilding } from './state';
import { townLevel } from './town';

export type Find = GameState['finds'][number];

export interface Appraisal {
  find: Find;
  name: string;
  coins: number;
}

export const antiqueShop = (): PlacedBuilding | undefined => state.buildings.find((b) => b.type === 'antiqueShop');

/** The shop only appraises with someone behind the counter. */
export const hasAppraiser = (b: PlacedBuilding): boolean => !!defOf(b).jobs && (workerCounts().get(b.id) ?? 0) > 0;

/** A condition for a new piece of junk, by the odds in JUNK.tiers. */
export function rollTier(roll = Math.random()): JunkTier {
  for (const t of JUNK.tiers) {
    if (roll < t.chance) return t.id;
    roll -= t.chance;
  }
  return 'worthless';
}

export const findName = (f: Find): string => JUNK_KINDS[f.kind].names[f.tier];

/** What the appraiser pays: scrap for worthless pieces, more for better ones, deeper areas and a bigger shop. */
export function findValue(f: Find, shopLevel = antiqueShop()?.level ?? 1): number {
  const tier = JUNK.tiers.find((t) => t.id === f.tier)!;
  if (tier.value === 0) return JUNK.scrap;
  const areaNo = Math.max(0, AREAS.findIndex((a) => a.id === f.area));
  const scale = townLevel() * JUNK_KINDS[f.kind].worth * (1 + JUNK.perShopLevel * (shopLevel - 1)) * (1 + JUNK.perArea * areaNo);
  return Math.max(JUNK.scrap + 1, Math.round(tier.value * scale));
}

/**
 * Junk just caught: kept for the Antique Shop if there is one (and room), otherwise scrap.
 * Returns the line for the catch screen and any coins paid now.
 */
export function pickUpJunk(kind: JunkId, area: AreaId): { text: string; coins: number } {
  const name = ITEMS[kind].name;
  const shop = antiqueShop();
  if (!shop || state.finds.length >= JUNK.maxFinds) {
    state.coins += JUNK.scrap;
    const why = !shop && townLevel() >= 4 ? ' (an Antique Shop would look at it)' : shop ? ' (the Antique Shop is full)' : '';
    return { text: `${name}. Scrap for $${JUNK.scrap}${why}`, coins: JUNK.scrap };
  }
  state.finds.push({ kind, tier: rollTier(), area });
  save();
  return { text: `${name}: off to the Antique Shop to be appraised`, coins: 0 };
}

/** Appraises and sells everything waiting at the shop, best first. */
export function appraiseAll(shop: PlacedBuilding): Appraisal[] {
  const out = state.finds.map((find) => ({ find, name: findName(find), coins: findValue(find, shop.level) }));
  out.sort((a, b) => b.coins - a.coins);
  state.coins += out.reduce((sum, a) => sum + a.coins, 0);
  state.finds = [];
  save();
  return out;
}
