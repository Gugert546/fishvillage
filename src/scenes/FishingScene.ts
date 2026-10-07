import Phaser from 'phaser';
import {
  FISH,
  FISH_DENSITY,
  FISH_PRICE_BONUS_PER_LEVEL,
  FULL_HOOK_RAMP_SECONDS,
  FULL_HOOK_REEL_MULTIPLIER,
  GAME_HEIGHT,
  GAME_WIDTH,
  HOOK_RADIUS,
  HOOK_STEER_SPEED,
  PX_PER_M,
  SURFACE_Y,
  WORLD_DEPTH_M,
  ZONES,
  type BaitDef,
  type FishType,
  type FishingStats,
} from '../config';
import { fishingStats, save, state } from '../state';
import { tickEconomy } from '../economy';
import { questEvent, takeQuestToasts } from '../quests';
import { hookBonus, marketBonus, sonarRange } from '../services';
import { consumeBait, cycleBait, readyBait, townLevel } from '../town';
import { makeTextures } from '../textures';
import {
  COLORS,
  Modal,
  TopBar,
  UI_DEPTH,
  fixToScreen,
  lerpColor,
  makeButton,
  makeText,
  openSettings,
  showOfflineEarnings,
  showToast,
  type Button,
} from '../ui';

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
  /** Ascent speed multiplier; climbs toward FULL_HOOK_REEL_MULTIPLIER once the hook is full. */
  private reelBoost = 1;
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
  private baitButton!: Button;
  /** Bait used on the current cast (sale bonus); fish in the water were lured by it too. */
  private activeBait?: BaitDef;
  /** Lighthouse sonar range in metres (0 = none). */
  private sonar = 0;
  /** Fish Market sale bonus for this visit to the dock. */
  private market = 0;
  private sonarGfx!: Phaser.GameObjects.Graphics;
  private sonarTags: Phaser.GameObjects.Text[] = [];
  private modal?: Modal;

  constructor() {
    super('Fishing');
  }

  create(): void {
    // Phaser reuses the scene instance when it restarts, so clear per-run state.
    this.fish = [];
    this.caught = [];
    this.modal = undefined;
    this.sonarTags = [];

    makeTextures(this);
    this.drawWorld();

    this.line = this.add.graphics().setDepth(10);
    this.sonarGfx = this.add.graphics().setDepth(8);
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

    this.topBar = new TopBar(this, false, () => {
      if (this.phase === 'idle' && !this.modal) openSettings(this, (m) => (this.modal = m));
    });
    this.depthText = this.topBar.right;
    this.hookText = hud(makeText(this, GAME_WIDTH / 2, 70, '', 18).setOrigin(0.5));
    this.promptText = hud(makeText(this, GAME_WIDTH / 2, SURFACE_Y + 130, 'Tap to cast', 30).setOrigin(0.5));
    this.tweens.add({ targets: this.promptText, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });

    this.townButton = hud(
      makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, 200, 52, 'Town', () => this.scene.start('Town'), COLORS.neutral),
    );
    // Tap to cycle through the bait you own; the water restocks to match.
    this.baitButton = hud(
      makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 124, 240, 46, '', () => {
        cycleBait();
        this.restockWater();
        this.refreshBaitButton();
      }, COLORS.primary, 18),
    );
  }

  private refreshBaitButton(): void {
    const owned = Object.values(state.bait).some((n) => (n ?? 0) > 0);
    const bait = readyBait();
    this.baitButton.setVisible(this.phase === 'idle' && owned);
    this.baitButton.setLabel(bait ? `Bait: ${bait.name} ×${state.bait[bait.id]}` : 'Bait: none');
    this.baitButton.setEnabledLook(true, bait ? COLORS.primary : COLORS.neutral);
  }

  /** Respawns the fish, e.g. after choosing different bait. */
  private restockWater(): void {
    for (const f of this.fish) f.sprite.destroy();
    this.fish = [];
    this.spawnFish();
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
    // Town services: Net Makers add hook capacity, Lighthouse keepers run the sonar.
    this.stats.capacity += hookBonus();
    this.sonar = sonarRange();
    this.market = marketBonus();
    for (const f of [...this.fish, ...this.caught]) f.sprite.destroy();
    this.fish = [];
    this.caught = [];
    this.activeBait = undefined;
    this.spawnFish();

    this.hookX = HOOK_REST.x;
    this.hookY = HOOK_REST.y;
    this.targetX = null;
    this.cameras.main.scrollY = 0;

    this.promptText.setVisible(true);
    this.townButton.setVisible(true);
    this.topBar.setSettingsVisible(true);
    this.hookText.setText('');
    this.refreshHud();
    this.refreshBaitButton();
  }

  private cast(): void {
    this.phase = 'descending';
    this.activeBait = consumeBait();
    this.baitButton.setVisible(false);
    this.shieldsLeft = this.stats.shields;
    this.invulnerableUntil = 0;
    this.promptText.setVisible(false);
    this.townButton.setVisible(false);
    this.topBar.setSettingsVisible(false);
  }

  private startAscent(): void {
    this.phase = 'ascending';
    this.reelBoost = 1;
  }

  private finishCast(): void {
    this.phase = 'results';
    this.targetX = null;

    const counts = new Map<FishType, number>();
    let total = 0;
    for (const f of this.caught) {
      counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
      total += this.priceOf(f.type);
      state.caught[f.type.id] = (state.caught[f.type.id] ?? 0) + 1;
    }
    state.coins += total;
    questEvent({ type: 'cast', fish: this.caught.map((f) => f.type.id), coins: total });
    save();
    this.refreshHud();
    this.showResults(counts, total);
  }

  // --------------------------------------------------------------- Fish

  private houseBonus(): number {
    return FISH_PRICE_BONUS_PER_LEVEL * (townLevel() - 1);
  }

  /** Sale price including your house's level bonus, the Fish Market and this cast's bait. */
  private priceOf(type: FishType): number {
    return Math.round(type.value * (1 + this.houseBonus() + this.market + (this.activeBait?.sellBonus ?? 0)));
  }

  private spawnFish(): void {
    // The bait you're about to use is already in the water, luring fish.
    const bait = readyBait();
    const density = FISH_DENSITY * (bait?.density ?? 1);
    for (let seg = 0; seg < WORLD_DEPTH_M; seg += 10) {
      const n = Math.floor(density + Math.random());
      for (let i = 0; i < n; i++) {
        const depth = seg + Math.random() * 10;
        const type = this.pickFishType(depth, bait);
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

  private pickFishType(depth: number, bait?: BaitDef): FishType | undefined {
    const options = FISH.filter((f) => depth >= f.minDepth && depth <= f.maxDepth);
    const weight = (f: FishType) => f.weight * (bait?.attract[f.id] ?? 1);
    let roll = Math.random() * options.reduce((sum, f) => sum + weight(f), 0);
    for (const f of options) {
      roll -= weight(f);
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

    const pop = makeText(this, this.hookX, this.hookY - 20, `+$${this.priceOf(f.type)}`, 18).setOrigin(0.5).setDepth(20);
    pop.setColor('#ffe066');
    this.tweens.add({ targets: pop, y: pop.y - 50, alpha: 0, duration: 800, onComplete: () => pop.destroy() });
  }

  // --------------------------------------------------------------- Loop

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const t = time / 1000;
    tickEconomy();
    for (const t of takeQuestToasts()) showToast(this, t);
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
      if (this.caught.length >= this.stats.capacity) {
        const rate = (FULL_HOOK_REEL_MULTIPLIER - 1) / FULL_HOOK_RAMP_SECONDS;
        this.reelBoost = Math.min(FULL_HOOK_REEL_MULTIPLIER, this.reelBoost + rate * dt);
      }
      this.hookY -= this.stats.ascentSpeed * this.reelBoost * PX_PER_M * dt;
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
    this.drawSonar(time);
    this.refreshHud();
  }

  /**
   * Lighthouse sonar: a ping ring from the hook, a price tag on every fish in range, and a
   * pulsing red ring on fish right in your path on the way down.
   */
  private drawSonar(time: number): void {
    const g = this.sonarGfx.clear();
    for (const t of this.sonarTags) t.setVisible(false);
    const casting = this.phase === 'descending' || this.phase === 'ascending';
    if (this.sonar <= 0 || !casting) return;

    const rangePx = this.sonar * PX_PER_M;
    const ping = (time % 1400) / 1400;
    g.lineStyle(2, 0x8ee88e, 0.5 * (1 - ping)).strokeCircle(this.hookX, this.hookY, ping * rangePx);

    let used = 0;
    const pulse = 0.5 + 0.5 * Math.sin(time / 90);
    for (const f of this.fish) {
      const dy = f.sprite.y - this.hookY;
      const inRange = this.phase === 'descending' ? dy > 0 && dy < rangePx : Math.abs(dy) < rangePx;
      if (!inRange) continue;

      const inPath = this.phase === 'descending' && Math.abs(f.sprite.x - this.hookX) < f.sprite.width / 2 + 22;
      if (inPath) {
        g.lineStyle(3, 0xff5a5a, 0.4 + 0.5 * pulse).strokeEllipse(f.sprite.x, f.sprite.y, f.sprite.width + 16, f.type.height + 16);
      }

      if (used >= 24) continue;
      let tag = this.sonarTags[used];
      if (!tag) {
        tag = makeText(this, 0, 0, '', 13).setOrigin(0.5, 1).setDepth(9);
        this.sonarTags.push(tag);
      }
      tag.setText(`$${this.priceOf(f.type)}`).setPosition(f.sprite.x, f.sprite.y - f.type.height / 2 - 4).setVisible(true);
      tag.setColor(inPath ? '#ff8a8a' : COLORS.gold);
      used++;
    }
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
    // Follow tighter while reeling in fast so the hook doesn't run off the top of the screen.
    const follow = this.reelBoost > 1 ? 14 : 8;
    cam.scrollY += (target - cam.scrollY) * Math.min(1, dt * follow);
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
    const bonuses: string[] = [];
    if (this.houseBonus() > 0) bonuses.push(`house +${Math.round(this.houseBonus() * 100)}%`);
    if (this.market > 0) bonuses.push(`market +${Math.round(this.market * 100)}%`);
    if (this.activeBait) bonuses.push(`${this.activeBait.name.toLowerCase()} +${Math.round(this.activeBait.sellBonus * 100)}%`);
    const bonus = bonuses.length > 0;
    const m = (this.modal = new Modal(this, 200 + rows * 34 + (bonus ? 26 : 0)));

    m.text(GAME_WIDTH / 2, m.top + 36, total > 0 ? 'Nice catch!' : 'Nothing this time', 28);
    let y = m.top + 84;
    if (bonus) {
      m.text(GAME_WIDTH / 2, y - 12, `Bonuses: ${bonuses.join(', ')}`, 14).setAlpha(0.75);
      y += 26;
    }
    if (counts.size === 0) m.text(GAME_WIDTH / 2, y, 'Steer into fish on the way up!', 18).setAlpha(0.8);
    for (const [type, n] of [...counts].sort((a, b) => b[0].value - a[0].value)) {
      m.add(this.add.image(60, y, `fish-${type.id}`).setScale(0.8));
      m.text(95, y, `${type.name} ×${n}`, 18, 0);
      m.text(GAME_WIDTH - 50, y, `$${this.priceOf(type) * n}`, 18, 1);
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
