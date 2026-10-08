// The logbook: every species you've ever caught, one page per fishing area.

import { AREAS, FISH, LOGBOOK_PAGE_BONUS, type AreaDef, type AreaId, type FishType } from './config';
import { state } from './state';

export const regularFish = (area: AreaId): FishType[] => FISH.filter((f) => f.area === area && !f.legendary);
export const legendOf = (area: AreaId): FishType | undefined => FISH.find((f) => f.area === area && f.legendary);
export const discovered = (fishId: string): boolean => (state.caught[fishId] ?? 0) > 0;

/** Regular species found on an area's page. */
export function pageProgress(area: AreaId): { found: number; total: number } {
  const fish = regularFish(area);
  return { found: fish.filter((f) => discovered(f.id)).length, total: fish.length };
}

export function pageComplete(area: AreaId): boolean {
  const { found, total } = pageProgress(area);
  return found === total;
}

/** Extra sale price for fish from this area, once its page is complete. */
export function logbookBonus(area: AreaId): number {
  return pageComplete(area) ? LOGBOOK_PAGE_BONUS : 0;
}

/** Species in the logbook, legendaries included. */
export function speciesCount(): number {
  return FISH.filter((f) => discovered(f.id)).length;
}

export const totalSpecies = (): number => FISH.length;

/** Pages that are complete right now, to spot the ones a cast just finished. */
export function completePages(): Set<AreaId> {
  return new Set(AREAS.filter((a: AreaDef) => pageComplete(a.id)).map((a) => a.id));
}
