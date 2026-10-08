// Perk tree: permanent upgrades bought with points from milestones. No resets needed to earn them.

import {
  AREAS,
  BUILDING_BY_ID,
  FISH,
  MAX_TOWN_LEVEL,
  PERKS,
  PERK_BY_ID,
  PERK_TIER_POINTS,
  SPECIES_PER_PERK_POINT,
  type LandmarkEffect,
  type PerkBranch,
  type PerkDef,
  type PerkId,
} from './config';
import { discovered, pageComplete, speciesCount } from './logbook';
import { queueToast } from './quests';
import { save, state } from './state';
import { townLevel } from './town';

export const perkRank = (id: PerkId): number => state.perks[id] ?? 0;
/** Total effect of a perk at its current rank (e.g. 0.1 = +10%). */
export const perkBonus = (id: PerkId): number => perkRank(id) * PERK_BY_ID[id].perRank;

/** Where perk points come from, with how many each source has given so far. */
export function pointSources(): { label: string; points: number; max: number }[] {
  const legends = FISH.filter((f) => f.legendary);
  const landmarks = Object.values(BUILDING_BY_ID).filter((d) => d.landmark);
  return [
    { label: 'Logbook pages', points: AREAS.filter((a) => pageComplete(a.id)).length, max: AREAS.length },
    { label: 'Legendary fish', points: legends.filter((f) => discovered(f.id)).length, max: legends.length },
    { label: `Every ${SPECIES_PER_PERK_POINT} species`, points: Math.floor(speciesCount() / SPECIES_PER_PERK_POINT), max: Math.floor(FISH.length / SPECIES_PER_PERK_POINT) },
    { label: 'Town levels 7+', points: Math.max(0, townLevel() - 6), max: MAX_TOWN_LEVEL - 6 },
    { label: 'Landmarks', points: state.landmarks.length, max: landmarks.length },
  ];
}

export const pointsEarned = (): number => pointSources().reduce((sum, s) => sum + s.points, 0);
export const pointsSpent = (): number => Object.values(state.perks).reduce((sum, r) => sum + (r ?? 0), 0);
export const pointsFree = (): number => Math.max(0, pointsEarned() - pointsSpent());

export function branchSpent(branch: PerkBranch): number {
  return PERKS.filter((p) => p.branch === branch).reduce((sum, p) => sum + perkRank(p.id), 0);
}

/** Deeper perks open up once enough points are in their branch. */
export const perkOpen = (def: PerkDef): boolean => branchSpent(def.branch) >= PERK_TIER_POINTS[def.tier];

export const canBuyPerk = (def: PerkDef): boolean => pointsFree() > 0 && perkOpen(def) && perkRank(def.id) < def.maxRank;

export function buyPerk(def: PerkDef): boolean {
  if (!canBuyPerk(def)) return false;
  state.perks[def.id] = perkRank(def.id) + 1;
  save();
  return true;
}

/** Hands every point back, free, so you can try a different build. */
export function resetPerks(): void {
  state.perks = {};
  save();
}

/** Announces newly earned perk points (called once a second). */
export function checkPerkPoints(): void {
  const earned = pointsEarned();
  if (state.perkPointsSeen < 0) state.perkPointsSeen = earned; // old saves: don't announce what they already had
  if (earned > state.perkPointsSeen) queueToast(`Perk point earned! Spend it at your house`);
  state.perkPointsSeen = earned;
}

/** Sum of one landmark effect over the landmarks standing in town. */
export function landmarkBonus(key: keyof LandmarkEffect): number {
  return state.buildings.reduce((sum, b) => sum + (BUILDING_BY_ID[b.type].landmark?.[key] ?? 0), 0);
}
