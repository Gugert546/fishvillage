import Phaser from 'phaser';
import {
  FISH,
  FISH_DENSITY,
  GAME_HEIGHT,
  GAME_WIDTH,
  HOOK_RADIUS,
  HOOK_STEER_SPEED,
  PX_PER_M,
  SURFACE_Y,
  WORLD_DEPTH_M,
  ZONES,
  type FishType,
  type FishingStats,
} from '../config';
import { fishingStats, save, state } from '../state';
import { tickEconomy } from '../economy';
import { makeTextures } from '../textures';
import { COLORS, Modal, TopBar, UI_DEPTH, fixToScreen, lerpColor, makeButton, makeText, showOfflineEarnings } from '../ui';

type Phase = 'idle' | 'descending' | 'ascending' | 'results';

interface Fish {
  type: FishType;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  /** Random offset so fish don't bob in sync. */
  seed: number;
  /** Position in the dangling stack once caught. */
  hangOffset?: number;
}

const WORLD_HEIGHT = SURFACE_Y + WORLD_DEPTH_M * PX_PER_M + GAME_HEIGHT;
const ROD_TIP = { x: 215, y: SURFACE_Y - 105 };
const HOOK_REST = { x: 235, y: SURFACE_Y + 18 };

export class FishingScene extends Phaser.Scene {
  private phase: Phase = 'idle';
  private stats!: FishingStats;
  private fish: Fish[] = [];
  private caught: Fish[] = [];

  private hookX = HOOK_REST.x;
  private hookY = HOOK_REST.y;
  private targetX: number | null = null;
  private shieldsLeft = 0;
  private invulnerableUntil = 0;

  private line!: Phaser.GameObjects.Graphics;
  private hook!: Phaser.GameObjects.Image;
  private shieldRing!: Phaser.GameObjects.Arc;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

  private topBar!: TopBar;
  private depthText!: Phaser.GameObjects.Text;
  private hookText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private townButton!: Phaser.GameObjects.Container;
  private modal?: Modal;

  constructor() {
    super('Fishing');
  }

  create(): void {
    // Phaser reuses the scene instance when it restarts, so clear per-run state.
    this.fish = [];
    this.caught = [];
    this.modal = undefined;

    makeTextures(this);
    this.drawWorld();

    this.line = this.add.graphics().setDepth(10);
    this.shieldRing = this.add.circle(0, 0, HOOK_RADIUS + 7).setStrokeStyle(2, 0xffe066, 0.9).setDepth(11);
    this.hook = this.add.image(0, 0, 'hook').setDepth(12);

    this.cameras.main.setBounds(0, 0, GAME_WIDTH, WORLD_HEIGHT);
    this.createHud();
    this.setupInput();
    this.resetToDock();
  }

  // ------------------------------------------------------------------ Setup

  private drawWorld(): void {
    const g = this.add.graphics();

    // Sky
    g.fillStyle(0xa8def0);
    g.fillRect(0, 0, GAME_WIDTH, SURFACE_Y);
    g.fillStyle(0xfff1b8);
    g.fillCircle(380, 70, 34);

    // Water: gradient through the zones
    const band = 8;
    for (let y = SURFACE_Y; y < WORLD_HEIGHT; y += band) {
      g.fillStyle(this.waterColorAt((y - SURFACE_Y) / PX_PER_M));
      g.fillRect(0, y, GAME_WIDTH, band);
    }
    g.fillStyle(0xd6f1fb, 0.8);
    g.fillRect(0, SURFACE_Y, GAME_WIDTH, 4);

    // Depth markers
    for (let m = 10; m <= WORLD_DEPTH_M; m += 10) {
      const y = SURFACE_Y + m * PX_PER_M;
      g.fillStyle(0xffffff, 0.25);
      g.fillRect(GAME_WIDTH - 18, y, 18, 2);
      makeText(this, GAME_WIDTH - 22, y, `${m}m`, 12).setOrigin(1, 0.5).setAlpha(0.35);
    }
    for (const zone of ZONES.slice(1)) {
      makeText(this, 12, SURFACE_Y + zone.from * PX_PER_M + 8, zone.name, 14).setAlpha(0.45);
    }

    // Dock
    const deckY = SURFACE_Y - 34;
    g.fillStyle(0x5c3a1e);
    for (const px of [18, 78, 138]) g.fillRect(px, deckY, 12, 70);
    g.fillStyle(0x8b5a2b);
    g.fillRect(0, deckY, 175, 14);
    g.fillStyle(0x6e4522);
    for (let x = 0; x < 175; x += 25) g.fillRect(x, deckY, 2, 14);

    // Fisher
    g.fillStyle(0x2f4858);
    g.fillRect(132, deckY - 30, 9, 30);
    g.fillStyle(0xe0a030);
    g.fillRect(128, deckY - 62, 20, 34);
    g.fillStyle(0xf2c9a0);
    g.fillCircle(138, deckY - 72, 10);
    g.fillStyle(0xc0392b);
    g.fillRect(126, deckY - 84, 24, 7);

    // Rod
    g.lineStyle(3, 0x4a2f1a);
    g.lineBetween(146, deckY - 45, ROD_TIP.x, ROD_TIP.y);
  }

  private waterColorAt(depthM: number): number {
    for (let i = 0; i < ZONES.length - 1; i++) {
      const a = ZONES[i];
      const b = ZONES[i + 1];
      if (depthM < b.from) return lerpColor(a.color, b.color, (depthM - a.from) / (b.from - a.from));
    }
    return ZONES[ZONES.length - 1].color;
  }

  private createHud(): void {
    const hud = <T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth>(obj: T): T =>
      fixToScreen(obj).setDepth(UI_DEPTH);

    this.topBar = new TopBar(this, false);
    this.depthText = this.topBar.right;
    this.hookText = hud(makeText(this, GAME_WIDTH / 2, 70, '', 18).setOrigin(0.5));
    this.promptText = hud(makeText(this, GAME_WIDTH / 2, SURFACE_Y + 130, 'Tap to cast', 30).setOrigin(0.5));
    this.tweens.add({ targets: this.promptText, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

    this.townButton = hud(
      makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, 200, 52, 'Town', () => this.scene.start('Town'), COLORS.neutral),
    );
  }

  private setupInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0 || this.modal) return;
      if (this.phase === 'idle') this.cast();
      else if (this.phase === 'descending' || this.phase === 'ascending') this.targetX = p.x;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown && (this.phase === 'descending' || this.phase === 'ascending')) this.targetX = p.x;
    });

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.input.keyboard.on('keydown-SPACE', () => {
        if (this.phase === 'idle' && !this.modal) this.cast();
      });
    }
  }

  // --------------------------------------------------------------- Flow

  private resetToDock(): void {
    this.phase = 'idle';
    this.stats = fishingStats();
    for (const f of [...this.fish, ...this.caught]) f.sprite.destroy();
    this.fish = [];
    this.caught = [];
    this.spawnFish();

    this.hookX = HOOK_REST.x;
    this.hookY = HOOK_REST.y;
    this.targetX = null;
    this.cameras.main.scrollY = 0;

    this.promptText.setVisible(true);
    this.townButton.setVisible(true);
    this.hookText.setText('');
    this.refreshHud();
  }

  private cast(): void {
    this.phase = 'descending';
    this.shieldsLeft = this.stats.shields;
    this.invulnerableUntil = 0;
    this.promptText.setVisible(false);
    this.townButton.setVisible(false);
  }

  private startAscent(): void {
    this.phase = 'ascending';
  }

  private finishCast(): void {
    this.phase = 'results';
    this.targetX = null;

    const counts = new Map<FishType, number>();
    let total = 0;
    for (const f of this.caught) {
      counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
      total += f.type.value;
      state.caught[f.type.id] = (state.caught[f.type.id] ?? 0) + 1;
    }
    state.coins += total;
    save();
    this.refreshHud();
    this.showResults(counts, total);
  }

  // --------------------------------------------------------------- Fish

  private spawnFish(): void {
    for (let seg = 0; seg < WORLD_DEPTH_M; seg += 10) {
      const n = Math.floor(FISH_DENSITY + Math.random());
      for (let i = 0; i < n; i++) {
        const depth = seg + Math.random() * 10;
        const type = this.pickFishType(depth);
        if (!type) continue;
        const x = Phaser.Math.Between(40, GAME_WIDTH - 40);
        const y = SURFACE_Y + depth * PX_PER_M;
        const speed = Phaser.Math.Between(type.speed[0], type.speed[1]);
        const vx = Math.random() < 0.5 ? -speed : speed;
        const sprite = this.add.image(x, y, `fish-${type.id}`).setDepth(5).setFlipX(vx < 0);
        this.fish.push({ type, sprite, x, y, vx, seed: Math.random() * 1000 });
      }
    }
  }

  private pickFishType(depth: number): FishType | undefined {
    const options = FISH.filter((f) => depth >= f.minDepth && depth <= f.maxDepth);
    let roll = Math.random() * options.reduce((sum, f) => sum + f.weight, 0);
    for (const f of options) {
      roll -= f.weight;
      if (roll <= 0) return f;
    }
    return options[options.length - 1];
  }

  private updateFish(dt: number, t: number): void {
    for (const f of this.fish) {
      f.x += f.vx * dt;
      const half = f.sprite.width / 2;
      if (f.x < half && f.vx < 0) f.vx = -f.vx;
      if (f.x > GAME_WIDTH - half && f.vx > 0) f.vx = -f.vx;
      const bob = f.type.erratic ? Math.sin(t * 2.5 + f.seed) * 18 : Math.sin(t * 1.5 + f.seed) * 3;
      f.sprite.setPosition(f.x, f.y + bob).setFlipX(f.vx < 0);
    }
  }

  private fishTouchingHook(): Fish | undefined {
    for (const f of this.fish) {
      const dx = f.sprite.x - this.hookX;
      const dy = f.sprite.y - this.hookY;
      const rx = f.sprite.width / 2 + HOOK_RADIUS * 0.5;
      const ry = f.type.height / 2 + HOOK_RADIUS * 0.5;
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return f;
    }
    return undefined;
  }

  private catchFish(f: Fish): void {
    this.fish.splice(this.fish.indexOf(f), 1);
    f.hangOffset = this.caught.reduce((sum, c) => sum + Math.min(c.type.width, 30) * 0.45, 0);
    this.caught.push(f);
    f.sprite.setDepth(9).setAngle(-90).setFlipX(false);

    const pop = makeText(this, this.hookX, this.hookY - 20, `+$${f.type.value}`, 18).setOrigin(0.5).setDepth(20);
    pop.setColor('#ffe066');
    this.tweens.add({ targets: pop, y: pop.y - 50, alpha: 0, duration: 800, onComplete: () => pop.destroy() });
  }

  // --------------------------------------------------------------- Loop

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const t = time / 1000;
    tickEconomy();
    if (this.phase === 'idle' && !this.modal) this.modal = showOfflineEarnings(this, () => (this.modal = undefined));
    this.updateFish(dt, t);

    if (this.phase === 'descending' || this.phase === 'ascending') {
      this.steerHook(dt);
    }

    if (this.phase === 'descending') {
      this.hookY += this.stats.descentSpeed * PX_PER_M * dt;
      const maxY = SURFACE_Y + this.stats.lineLength * PX_PER_M;
      const hit = time >= this.invulnerableUntil ? this.fishTouchingHook() : undefined;
      if (hit) {
        if (this.shieldsLeft > 0) {
          this.shieldsLeft--;
          this.invulnerableUntil = time + 700;
          hit.vx = -hit.vx * 1.5;
          this.cameras.main.shake(80, 0.004);
        } else {
          this.catchFish(hit);
          this.cameras.main.shake(120, 0.006);
          this.startAscent();
        }
      } else if (this.hookY >= maxY) {
        this.hookY = maxY;
        this.startAscent();
      }
    } else if (this.phase === 'ascending') {
      this.hookY -= this.stats.ascentSpeed * PX_PER_M * dt;
      if (this.caught.length < this.stats.capacity) {
        const f = this.fishTouchingHook();
        if (f) this.catchFish(f);
      }
      if (this.hookY <= HOOK_REST.y) {
        this.hookY = HOOK_REST.y;
        this.finishCast();
      }
    }

    this.updateCamera(dt);
    this.drawLineAndHook(time);
    this.refreshHud();
  }

  private steerHook(dt: number): void {
    let target = this.targetX;
    if (this.cursors?.left.isDown) target = this.hookX - 200;
    else if (this.cursors?.right.isDown) target = this.hookX + 200;
    if (target === null) return;
    target = Phaser.Math.Clamp(target, 16, GAME_WIDTH - 16);
    const maxStep = HOOK_STEER_SPEED * dt;
    this.hookX += Phaser.Math.Clamp(target - this.hookX, -maxStep, maxStep);
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    let target = 0;
    if (this.phase === 'descending') target = this.hookY - GAME_HEIGHT * 0.3;
    else if (this.phase === 'ascending') target = this.hookY - GAME_HEIGHT * 0.65;
    cam.scrollY += (target - cam.scrollY) * Math.min(1, dt * 8);
  }

  private drawLineAndHook(time: number): void {
    this.line.clear();
    this.line.lineStyle(1.5, 0xffffff, 0.85);
    this.line.lineBetween(ROD_TIP.x, ROD_TIP.y, this.hookX, this.hookY - 10);

    this.hook.setPosition(this.hookX, this.hookY);
    const blinking = time < this.invulnerableUntil && Math.floor(time / 80) % 2 === 0;
    this.hook.setAlpha(blinking ? 0.3 : 1);

    const showShield = this.phase === 'descending' && this.shieldsLeft > 0;
    this.shieldRing.setVisible(showShield).setPosition(this.hookX, this.hookY);

    const sway = Math.sin(time / 150) * 3;
    for (const f of this.caught) {
      f.sprite.setPosition(this.hookX + sway, this.hookY + 8 + f.sprite.width / 2 + (f.hangOffset ?? 0));
    }
  }

  private refreshHud(): void {
    this.topBar.update();
    const depth = Math.max(0, Math.round((this.hookY - SURFACE_Y) / PX_PER_M));
    this.depthText.setText(this.phase === 'idle' ? `Line ${this.stats.lineLength} m` : `${depth} / ${this.stats.lineLength} m`);

    if (this.phase === 'descending') {
      this.hookText.setText(this.stats.shields > 0 ? `Lure: ${'●'.repeat(this.shieldsLeft)}${'○'.repeat(this.stats.shields - this.shieldsLeft)}` : '');
    } else if (this.phase === 'ascending') {
      const full = this.caught.length >= this.stats.capacity;
      this.hookText.setText(full ? 'Hook full!' : `Hook ${this.caught.length} / ${this.stats.capacity}`);
    }
  }

  // ----------------------------------------------------------------- UI

  private showResults(counts: Map<FishType, number>, total: number): void {
    const rows = Math.max(1, counts.size);
    const m = (this.modal = new Modal(this, 200 + rows * 34));

    m.text(GAME_WIDTH / 2, m.top + 36, total > 0 ? 'Nice catch!' : 'Nothing this time', 28);
    let y = m.top + 84;
    if (counts.size === 0) m.text(GAME_WIDTH / 2, y, 'Steer into fish on the way up!', 18).setAlpha(0.8);
    for (const [type, n] of [...counts].sort((a, b) => b[0].value - a[0].value)) {
      m.add(this.add.image(60, y, `fish-${type.id}`).setScale(0.8));
      m.text(95, y, `${type.name} ×${n}`, 18, 0);
      m.text(GAME_WIDTH - 50, y, `$${type.value * n}`, 18, 1);
      y += 34;
    }
    m.text(GAME_WIDTH / 2, y + 16, `+$${total}`, 32).setColor(COLORS.gold);
    m.add(
      makeButton(this, GAME_WIDTH / 2, m.top + m.height - 40, 180, 48, 'Continue', () => {
        m.destroy();
        this.modal = undefined;
        this.resetToDock();
      }),
    );
  }
}
