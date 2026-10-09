// Town projects: big builds paid for a chunk at a time, each with a lasting effect.

import { PROJECTS, PROJECT_CHUNKS, type ProjectDef, type ProjectId } from './config';
import { save, state } from './state';
import { townLevel } from './town';
import { canAfford, spend } from './dev';

export const projectFunded = (p: ProjectDef): number => state.projects[p.id] ?? 0;
export const projectDone = (id: ProjectId): boolean => {
  const p = PROJECTS.find((x) => x.id === id)!;
  return projectFunded(p) >= p.cost;
};
export const projectUnlocked = (p: ProjectDef): boolean => townLevel() >= p.unlockLevel;

/** The next chunk to pay (the last one may be smaller). */
export function nextChunk(p: ProjectDef): number {
  return Math.min(Math.ceil(p.cost / PROJECT_CHUNKS), p.cost - projectFunded(p));
}

export function fundProject(p: ProjectDef): boolean {
  const chunk = nextChunk(p);
  if (!projectUnlocked(p) || chunk <= 0 || !canAfford(chunk)) return false;
  spend(chunk);
  state.projects[p.id] = projectFunded(p) + chunk;
  save();
  return true;
}
