import Phaser from 'phaser';
import { GRID_X, TILE } from '../config';
import { WalkGrid, type Tile } from '../pathfinding';
import { state, type PlacedBuilding, type Resident } from '../state';

const MAX_WALKERS = 14;
const SCHEDULE_MS = 500;
const SPEED_GRASS = 30;
const SPEED_ROAD = 50;
/** Seconds a resident stays put between trips. */
const STAY_MIN = 10;
const STAY_MAX = 35;
/** Seconds a strolling resident lingers at their spot before heading home. */
const LINGER_MIN = 3;
const LINGER_MAX = 8;
const DEPTH = 12;

const SHIRTS = [0xe76f51, 0x2a9d8f, 0xe9c46a, 0x8ab17d, 0x9d4edd, 0x457b9d, 0xf4a261, 0xd62828, 0x6d597a];
const SKIN = [0xf2c9a0, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIR = [0x3b2a20, 0x6b4f3a, 0xd4a373, 0x222222, 0xb5651d];

/** A tiny villager figure, feet at (0, 0). Colours are stable per resident id. */
export function makePerson(scene: Phaser.Scene, id: number): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.2);
  g.fillEllipse(0, 0, 10, 4);
  g.fillStyle(0x3d405b);
  g.fillRect(-3, -6, 2.5, 6);
  g.fillRect(0.5, -6, 2.5, 6);
  g.fillStyle(SHIRTS[id % SHIRTS.length]);
  g.fillRoundedRect(-4, -13, 8, 8, 2);
  g.fillStyle(SKIN[(id * 7) % SKIN.length]);
  g.fillCircle(0, -16, 3.5);
  g.fillStyle(HAIR[(id * 3) % HAIR.length]);
  g.fillRect(-3.5, -20, 7, 2.5);
  return scene.add.container(0, 0, [g]);
}

/** You, the fisher from the dock: orange jacket and red cap. Feet at (0, 0). */
export function makePlayer(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.2);
  g.fillEllipse(0, 0, 11, 4);
  g.fillStyle(0x2f4858);
  g.fillRect(-3, -7, 2.5, 7);
  g.fillRect(0.5, -7, 2.5, 7);
  g.fillStyle(0xe0a030);
  g.fillRoundedRect(-4.5, -15, 9, 9, 2);
  g.fillStyle(0xf2c9a0);
  g.fillCircle(0, -18, 3.8);
  g.fillStyle(0xc0392b);
  g.fillRect(-4.5, -23, 9, 3);
  return scene.add.container(0, 0, [g]);
}

export function tileCenter(t: Tile): { x: number; y: number } {
  return { x: GRID_X + t.col * TILE + TILE / 2, y: -t.row * TILE - TILE / 2 };
}

type Place = 'home' | 'work' | 'out';

interface Walker {
  sprite: Phaser.GameObjects.Container;
  path: Tile[];
  /** Index of the tile currently being walked toward. */
  step: number;
  dest: Place;
  /** While > now (ms), the walker stands still (lingering on a stroll). */
  waitUntil: number;
  phase: number;
}

/** Residents walking between home, work and the occasional stroll. */
export class Villagers {
  private walkers = new Map<number, Walker>();
  private place = new Map<number, Place>();
  private nextTrip = new Map<number, number>();
  private grid?: WalkGrid;
  private gridKey = '';
  private sinceSchedule = 0;

  constructor(private scene: Phaser.Scene) {
    // Start mid-day: people are spread between home and work, with trips staggered.
    const now = scene.time.now;
    for (const r of state.residents) {
      this.place.set(r.id, r.job !== null && Math.random() < 0.5 ? 'work' : 'home');
      this.nextTrip.set(r.id, now + Math.random() * 12000);
    }
  }

  update(deltaMs: number, now: number): void {
    this.sinceSchedule += deltaMs;
    if (this.sinceSchedule >= SCHEDULE_MS) {
      this.sinceSchedule = 0;
      this.refreshGrid();
      this.dropGone();
      this.schedule(now);
    }
    for (const [id, w] of this.walkers) this.move(id, w, deltaMs / 1000, now);
  }

  destroy(): void {
    for (const w of this.walkers.values()) w.sprite.destroy();
    this.walkers.clear();
  }

  private refreshGrid(): void {
    const key = `${state.expansions}|` + state.buildings.map((b) => `${b.id}:${b.col}:${b.row}`).join(',');
    if (key === this.gridKey && this.grid) return;
    this.gridKey = key;
    this.grid = new WalkGrid();
  }

  /** Forget residents who left town. */
  private dropGone(): void {
    const alive = new Set(state.residents.map((r) => r.id));
    for (const [id, w] of this.walkers) {
      if (!alive.has(id)) {
        w.sprite.destroy();
        this.walkers.delete(id);
      }
    }
  }

  private building(id: number | null): PlacedBuilding | undefined {
    return id === null ? undefined : state.buildings.find((b) => b.id === id);
  }

  private schedule(now: number): void {
    if (this.walkers.size >= MAX_WALKERS) return;
    for (const r of state.residents) {
      if (this.walkers.size >= MAX_WALKERS) return;
      if (this.walkers.has(r.id)) continue;
      const due = this.nextTrip.get(r.id);
      if (due === undefined) {
        // New arrival: they just walked in, so give them a moment at home.
        this.place.set(r.id, 'home');
        this.nextTrip.set(r.id, now + 4000 + Math.random() * 8000);
        continue;
      }
      if (due <= now) this.startTrip(r, now);
    }
  }

  private startTrip(r: Resident, now: number): void {
    const grid = this.grid!;
    const home = this.building(r.home);
    const work = this.building(r.job);
    const at = this.place.get(r.id) ?? 'home';

    // Someone whose workplace was sold sets off from home instead.
    const fromBuilding = at === 'work' && work ? work : home;
    const from = fromBuilding && grid.doorOf(fromBuilding);

    let dest: Place;
    let to: Tile | undefined;
    if (at === 'home' && work) {
      dest = 'work';
      to = grid.doorOf(work);
    } else if (at === 'home') {
      dest = 'out';
      to = grid.randomWalkable();
    } else {
      dest = 'home';
      to = home && grid.doorOf(home);
    }

    const path = from && to ? grid.findPath(from, to) : undefined;
    if (!path || path.length < 2) {
      // Nowhere to walk: skip the trip but keep the routine going.
      this.place.set(r.id, dest === 'out' ? 'home' : dest);
      this.nextTrip.set(r.id, now + (STAY_MIN + Math.random() * (STAY_MAX - STAY_MIN)) * 1000);
      return;
    }
    const sprite = makePerson(this.scene, r.id).setDepth(DEPTH).setAlpha(0);
    const start = tileCenter(path[0]);
    sprite.setPosition(start.x, start.y);
    this.scene.tweens.add({ targets: sprite, alpha: 1, duration: 250 });
    this.walkers.set(r.id, { sprite, path, step: 1, dest, waitUntil: 0, phase: Math.random() * 10 });
  }

  private move(id: number, w: Walker, dt: number, now: number): void {
    if (w.waitUntil > now) return;
    if (w.step >= w.path.length) {
      this.arrive(id, w, now);
      return;
    }
    const target = w.path[w.step];
    const p = tileCenter(target);
    const speed = this.grid?.isRoad(target.col, target.row) ? SPEED_ROAD : SPEED_GRASS;
    const s = w.sprite;
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = speed * dt;
    if (dist <= stepLen) {
      s.setPosition(p.x, p.y);
      w.step++;
    } else {
      s.setPosition(s.x + (dx / dist) * stepLen, s.y + (dy / dist) * stepLen);
    }
    if (Math.abs(dx) > 0.5) s.setScale(dx < 0 ? -1 : 1, 1);
    // Little walking bob
    w.phase += dt * 14;
    const body = s.list[0] as Phaser.GameObjects.Graphics;
    body.y = -Math.abs(Math.sin(w.phase)) * 1.5;
  }

  private arrive(id: number, w: Walker, now: number): void {
    if (w.dest === 'out') {
      // Linger at the stroll spot, then turn around and head home from here.
      const home = this.building(state.residents.find((r) => r.id === id)?.home ?? null);
      const spot = w.path[w.path.length - 1];
      const back = home && this.grid?.doorOf(home);
      const path = back ? this.grid!.findPath(spot, back) : undefined;
      if (path && path.length >= 2) {
        w.path = path;
        w.step = 1;
        w.dest = 'home';
        w.waitUntil = now + (LINGER_MIN + Math.random() * (LINGER_MAX - LINGER_MIN)) * 1000;
        return;
      }
    }
    this.place.set(id, w.dest === 'out' ? 'home' : w.dest);
    this.nextTrip.set(id, now + (STAY_MIN + Math.random() * (STAY_MAX - STAY_MIN)) * 1000);
    this.walkers.delete(id);
    const sprite = w.sprite;
    this.scene.tweens.add({ targets: sprite, alpha: 0, duration: 250, onComplete: () => sprite.destroy() });
  }
}
