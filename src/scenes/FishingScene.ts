import Phaser from 'phaser';
import {
  AREAS,
  FISH,
  FULL_HOOK_RAMP_SECONDS,
  FULL_HOOK_REEL_MULTIPLIER,
  GAME_HEIGHT,
  GAME_WIDTH,
  HOOK_RADIUS,
  HOOK_STEER_SPEED,
  HAZARD_INFO,
  WORLD,
  LEGENDARY,
  LOGBOOK_PAGE_BONUS,
  PX_PER_M,
  STING_SECONDS,
  SURFACE_Y,
  type AreaDef,
  type BaitDef,
  type HazardKind,
  type FishType,
  type FishingStats,
} from '../config';
import { fishingStats, state } from '../state';
import { tickEconomy } from '../economy';
import { questEvent, takeQuestToasts } from '../quests';
import { hookBonus, sonarRange } from '../services';
import { boatUnlocked, consumeBait, currentArea, cycleBait, ownsArea, readyBait, sailTo, stormBound, townLevel } from '../town';
import { makeDarknessTexture, makeTextures } from '../textures';
import { preloadSprites } from '../sprites';
import { Art } from '../art/kit';
import { PAL, Pix, pixImage, pixTexture } from '../pixel';
import { completePages, discovered, legendOf } from '../logbook';
import { crateCapacity, cratesUsed } from '../crates';
import { dailyFactor, salePrice, sellFish, stowCatch, type CatchResult } from '../market';
import { landmarkBonus, perkBonus } from '../perks';
import { Atmosphere } from '../atmosphere';
import { sfx } from '../sound';
import { fishOfTheDay, isNight, weather } from '../world';
import { useCharm } from '../merchant';
import { projectDone } from '../projects';
import {
  COLORS,
  Modal,
  TopBar,
  UI_DEPTH,
  fixToScreen,
  lerpColor,
  makeButton,
  makeText,
  onTap,
  formatCoins,
  openLogbook,
  openMarket,
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
  /** Legendary fish dart away from the hook until this time (seconds). */
  fleeUntil?: number;
  baseSpeed?: number;
}

interface Hazard {
  kind: HazardKind;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  seed: number;
  /** A hazard that just hit leaves you alone for a moment. */
  calmUntil: number;
}

/** Moored boats at the Harbor: small, side by side to the right of the hook. */
const MOORING_X = [254, 303, 352, 401];
const MOORED_SCALE = 0.23;
const ROD_TIP = { x: 215, y: SURFACE_Y - 105 };
const HOOK_REST = { x: 235, y: SURFACE_Y + 18 };

export class FishingScene extends Phaser.Scene {
  private phase: Phase = 'idle';
  private stats!: FishingStats;
  private area!: AreaDef;
  private worldHeight = 0;
  private fish: Fish[] = [];
  private caught: Fish[] = [];
  private hazards: Hazard[] = [];
  /** Jellyfish sting: no steering until then. */
  private stunnedUntil = 0;
  private darkness?: Phaser.GameObjects.Image;
  private areaButton!: Button;
  private logbookButton!: Button;
  private atmosphere!: Atmosphere;
  /** Sun by day, moon by night (always a pale moon over the Trench). */
  private sun!: Phaser.GameObjects.Image;
  private moon!: Phaser.GameObjects.Image;
  private skyNight?: boolean;
  private todayText!: Phaser.GameObjects.Text;
  private lastStormCheck = 0;
  /** Gold shimmer around legendary fish (drawn above the dark). */
  private glowGfx!: Phaser.GameObjects.Graphics;
  /** Tap areas on the moored boats (only while on the dock). */
  private boatZones: Phaser.GameObjects.Zone[] = [];

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
  /** Lighthouse sonar range in metres (0 = none). */
  private sonar = 0;
  private charmsText!: Phaser.GameObjects.Text;
  private barrelsButton!: Button;
  private sonarGfx!: Phaser.GameObjects.Graphics;
  private sonarTags: Phaser.GameObjects.Text[] = [];
  private modal?: Modal;

  constructor() {
    super('Fishing');
  }

  preload(): void {
    preloadSprites(this);
  }

  create(): void {
    // Phaser reuses the scene instance when it restarts, so clear per-run state.
    this.fish = [];
    this.caught = [];
    this.hazards = [];
    this.boatZones = [];
    this.lastStormCheck = 0;
    this.skyNight = undefined;
    this.modal = undefined;
    this.sonarTags = [];
    this.darkness = undefined;
    this.area = currentArea();
    this.worldHeight = SURFACE_Y + this.area.depth * PX_PER_M + GAME_HEIGHT;

    makeTextures(this);
    this.drawWorld();
    if (this.area.dark) {
      // Above the fish but below the sonar, the line and the catch.
      makeDarknessTexture(this, GAME_WIDTH * 2, GAME_HEIGHT * 2);
      this.darkness = this.add.image(0, 0, 'darkness').setScale(3).setDepth(7).setAlpha(0);
    }

    this.line = this.add.graphics().setDepth(10);
    this.sonarGfx = this.add.graphics().setDepth(8);
    this.glowGfx = this.add.graphics().setDepth(8);
    this.shieldRing = this.add.circle(0, 0, HOOK_RADIUS + 7).setStrokeStyle(2, 0xffe066, 0.9).setDepth(11);
    this.hook = this.add.image(0, 0, 'hook').setDepth(12);

    this.cameras.main.setBounds(0, 0, GAME_WIDTH, this.worldHeight);
    this.createHud();
    this.atmosphere = new Atmosphere(this);
    this.setupInput();
    this.resetToDock();
  }

  // ------------------------------------------------------------------ Setup

  private drawWorld(): void {
    const area = this.area;
    const g = this.add.graphics();
    const depthPx = (m: number) => SURFACE_Y + m * PX_PER_M;

    // Sky
    g.fillStyle(area.sky);
    g.fillRect(0, 0, GAME_WIDTH, SURFACE_Y);
    this.sun = pixImage(this, 'sun', 344, 34, 72, 72, (p) => {
      p.fillStyle(PAL.amber).fillCircle(380, 70, 34);
      p.fillStyle(PAL.yellow).fillCircle(380, 70, 30);
      p.fillStyle(PAL.white).fillCircle(368, 58, 8);
    });
    this.moon = pixImage(this, 'moon', 356, 46, 48, 48, (p) => {
      p.fillStyle(PAL.cloud).fillCircle(380, 70, 22);
      p.fillStyle(PAL.white).fillCircle(376, 66, 17);
      p.fillStyle(PAL.cloud).fillCircle(372, 64, 4).fillCircle(386, 76, 3);
      p.outline(PAL.slate);
    });
    this.drawClouds();
    this.drawSkyBody();

    // Water: gradient through the zones
    const band = 8;
    for (let y = SURFACE_Y; y < this.worldHeight; y += band) {
      g.fillStyle(this.waterColorAt((y - SURFACE_Y) / PX_PER_M));
      g.fillRect(0, y, GAME_WIDTH, band);
    }
    g.fillStyle(0xd6f1fb, 0.8);
    g.fillRect(0, SURFACE_Y, GAME_WIDTH, 4);

    // Sea floor just below the deepest fish
    const floorY = depthPx(area.depth + 3);
    g.fillStyle(area.id === 'reef' ? 0xe9d8a6 : 0x2e2c29);
    g.fillRect(0, floorY, GAME_WIDTH, this.worldHeight - floorY);
    if (area.id === 'reef') {
      const reef = new Pix(0, floorY - 90, GAME_WIDTH, 90);
      const corals = [PAL.salmon, PAL.copper, PAL.magenta, PAL.pink, PAL.lime];
      for (let i = 0, x = 10; x < GAME_WIDTH; i++, x += 34) {
        reef.fillStyle(corals[i % corals.length]);
        const hgt = 30 + ((i * 23) % 40);
        reef.fillRect(x + 8, floorY - hgt, 6, hgt);
        reef.fillCircle(x + 11, floorY - hgt, 9);
        reef.fillCircle(x + 2, floorY - hgt * 0.6, 6);
        reef.fillCircle(x + 20, floorY - hgt * 0.7, 7);
      }
      reef.outline();
      reef.toImage(this, 'reef');
    }

    // Depth markers
    for (let m = 10; m <= area.depth; m += 10) {
      const y = depthPx(m);
      g.fillStyle(0xffffff, 0.25);
      g.fillRect(GAME_WIDTH - 18, y, 18, 2);
      makeText(this, GAME_WIDTH - 22, y, `${m}m`, 12).setOrigin(1, 0.5).setAlpha(0.35);
    }
    for (const zone of area.zones.slice(1)) {
      makeText(this, 12, depthPx(zone.from) + 8, zone.name, 14).setAlpha(0.45);
    }

    const deckY = SURFACE_Y - 34;
    // Everything above the waterline (dock or boat, the fisher, the rod) as one pixel picture.
    const view = new Pix(-10, 0, GAME_WIDTH + 20, SURFACE_Y + 60);
    if (area.id === 'harbor') {
      this.drawMooredBoats();
      for (const px of [18, 78, 138]) {
        view.fillStyle(PAL.brown).fillRect(px, deckY, 12, 70);
        view.fillStyle(PAL.clay).fillRect(px, deckY, 2, 70);
        view.fillStyle(PAL.bark).fillRect(px + 10, deckY, 2, 70).fillRect(px, SURFACE_Y + 6, 12, 2);
      }
      view.fillStyle(PAL.clay).fillRect(-4, deckY, 180, 14);
      view.fillStyle(PAL.tan).fillRect(-4, deckY, 180, 4);
      view.fillStyle(PAL.brown).fillRect(-4, deckY + 10, 180, 4);
      for (let x = 22; x < 176; x += 24) view.fillRect(x, deckY, 2, 10);
      view.fillStyle(PAL.bark);
      for (let x = 10; x < 176; x += 24) view.fillRect(x, deckY + 6, 2, 2);
      // Barrels for the catch, stacked at the end of the dock
      for (const [bx, top] of [[6, deckY - 28], [34, deckY - 28], [20, deckY - 54]] as [number, number][]) {
        view.fillStyle(PAL.brown).fillRect(bx, top, 24, 26);
        view.fillStyle(PAL.clay).fillRect(bx + 2, top, 6, 26);
        view.fillStyle(PAL.bark).fillRect(bx, top + 4, 24, 2).fillRect(bx, top + 20, 24, 2);
      }
    } else {
      if (area.id === 'arctic') {
        // Floating ice on the surface
        view.fillStyle(PAL.white);
        for (const [x, w] of [[300, 46], [372, 30], [418, 40]]) view.fillRect(x, SURFACE_Y - 6, w, 12);
        view.fillStyle(PAL.cloud);
        for (const [x, w] of [[300, 46], [372, 30], [418, 40]]) view.fillRect(x, SURFACE_Y + 2, w, 4);
      }
      this.drawBoat(view, 0, SURFACE_Y, 1, area);
    }
    drawFisher(new Art(view), 63, deckY / 2);
    view.lineStyle(3, PAL.bark).lineBetween(146, deckY - 45, ROD_TIP.x, ROD_TIP.y);
    view.outline();
    view.toImage(this, `scenery-${area.id}`);
  }

  private drawSkyBody(): void {
    const night = isNight() || !!this.area.dark;
    if (night === this.skyNight) return;
    this.skyNight = night;
    this.sun.setVisible(!night);
    this.moon.setVisible(night);
  }

  /** A few pixel clouds drifting slowly across the sky. */
  private drawClouds(): void {
    const key = pixTexture(this, 'cloud', -40, -14, 80, 28, (p) => {
      p.fillStyle(PAL.cloud).fillEllipse(0, 4, 76, 16);
      p.fillStyle(PAL.white).fillEllipse(-12, -2, 36, 20).fillEllipse(12, -4, 40, 20).fillEllipse(0, 2, 70, 12);
    }).key;
    for (const [x, y, speed] of [[60, 60, 1], [250, 120, 0.7], [420, 30, 0.5]]) {
      const cloud = this.add.image(x, y, key).setAlpha(0.9);
      this.tweens.add({ targets: cloud, x: x + 60 * speed, duration: 20000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
  }

  /**
   * A boat with its deck `34 × s` px above the waterline, starting at `x`. Each area's boat
   * gets its own superstructure.
   */
  private drawBoat(g: Pix, x: number, waterY: number, s: number, area: AreaDef): void {
    const P = (px: number, py: number) => new Phaser.Math.Vector2(x + px * s, waterY + py * s);
    const line = (a: Phaser.Math.Vector2, b: Phaser.Math.Vector2) => g.lineBetween(a.x, a.y, b.x, b.y);
    const tri = (a: Phaser.Math.Vector2, b: Phaser.Math.Vector2, c: Phaser.Math.Vector2) => g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
    const rect = (px: number, py: number, w: number, h: number) => g.fillRect(x + px * s, waterY + py * s, w * s, h * s);
    const hull = area.hull ?? 0xffffff;
    const cabin = area.cabin ?? 0x888888;

    // Superstructure first, so the hull covers its bottom edge.
    if (area.id === 'reef') {
      g.lineStyle(Math.max(1, 3 * s), 0x6b4f3a);
      line(P(100, -34), P(100, -170));
      g.fillStyle(0xfdfdfd, 0.95);
      tri(P(104, -165), P(104, -44), P(178, -44));
      g.fillStyle(cabin);
      tri(P(96, -150), P(96, -50), P(40, -50));
    } else if (area.id === 'trench') {
      g.fillStyle(cabin);
      rect(30, -82, 64, 50);
      g.fillStyle(0x2b2d42);
      rect(38, -72, 48, 12);
      g.lineStyle(Math.max(1, 4 * s), 0xf4a261);
      line(P(4, -34), P(16, -120));
      line(P(28, -34), P(16, -120));
      g.lineStyle(Math.max(1, 1.5 * s), 0x222222);
      line(P(16, -120), P(-6, -10));
    } else if (area.id === 'arctic') {
      g.fillStyle(cabin);
      rect(18, -100, 76, 66);
      g.fillStyle(hull);
      rect(18, -100, 76, 10);
      g.fillStyle(0x2b2d42);
      for (const wx of [26, 48, 70]) rect(wx, -84, 14, 10);
      g.fillStyle(0x333333);
      rect(46, -122, 18, 22);
      g.fillStyle(hull);
      rect(46, -122, 18, 6);
    } else {
      g.fillStyle(cabin);
      rect(20, -76, 62, 42);
      g.fillStyle(0xfff3b0);
      rect(30, -66, 16, 12);
      rect(54, -66, 16, 12);
      g.lineStyle(Math.max(1, 3 * s), 0x6b4f3a);
      line(P(100, -34), P(100, -118));
    }

    g.fillStyle(hull);
    g.fillPoints([P(-4, -34), P(194, -34), P(178, 12), P(12, 12)], true);
    g.fillStyle(lerpColor(hull, 0x000000, 0.35));
    g.fillPoints([P(-2, -12), P(186, -12), P(182, 0), P(4, 0)], true);
    g.fillStyle(lerpColor(hull, 0x000000, 0.15));
    rect(-4, -34, 198, 5);
  }

  /** Bought boats wait at the Harbor; tap one to sail to its area. */
  private drawMooredBoats(): void {
    const owned = AREAS.filter((a) => a.boat && ownsArea(a));
    owned.forEach((area, i) => {
      const x = MOORING_X[i];
      const t = pixTexture(this, `moored-${area.id}`, -4, -42, 52, 48, (p) => {
        this.drawBoat(p, 0, 0, MOORED_SCALE, area);
        p.outline();
      });
      const g = this.add.image(x + t.x, SURFACE_Y + 2 + t.y, t.key).setOrigin(0).setDepth(1);
      this.tweens.add({ targets: g, y: g.y + 2, duration: 1100 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const w = 200 * MOORED_SCALE;
      const zone = this.add.zone(x + w / 2, SURFACE_Y - 18, w, 52);
      onTap(zone, () => {
        if (this.phase === 'idle' && !this.modal) this.sail(area);
      });
      this.boatZones.push(zone);
    });
  }

  private sail(area: AreaDef): void {
    if (area.id === this.area.id) return;
    if (stormBound() && area.id !== 'harbor') {
      showToast(this, 'Storm! The boats stay in port');
      return;
    }
    sailTo(area);
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
  }

  private waterColorAt(depthM: number): number {
    const zones = this.area.zones;
    for (let i = 0; i < zones.length - 1; i++) {
      const a = zones[i];
      const b = zones[i + 1];
      if (depthM < b.from) return lerpColor(a.color, b.color, (depthM - a.from) / (b.from - a.from));
    }
    return zones[zones.length - 1].color;
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
    this.todayText = hud(makeText(this, GAME_WIDTH / 2, SURFACE_Y + 172, '', 15).setOrigin(0.5).setColor(COLORS.gold));
    this.charmsText = hud(makeText(this, GAME_WIDTH / 2, SURFACE_Y + 196, '', 13).setOrigin(0.5).setColor('#e7b6f7'));

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
    this.logbookButton = hud(
      makeButton(this, 62, 82, 104, 36, 'Logbook', () => {
        if (this.phase === 'idle' && !this.modal) openLogbook(this, (m) => (this.modal = m), this.areaPage());
      }, COLORS.neutral, 15),
    );
    this.barrelsButton = hud(
      makeButton(this, 62, 124, 104, 36, '', () => {
        if (this.phase === 'idle' && !this.modal) openMarket(this, (m) => (this.modal = m), 0, () => this.refreshHud());
      }, COLORS.neutral, 14),
    );
    this.areaButton = hud(
      makeButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 184, 240, 46, '', () => this.openAreaPicker(), COLORS.neutral, 18),
    );
    this.cameras.main.fadeIn(250, 0, 0, 0);
  }

  /** Fishing spots: sail to one you own a boat for; the rest show what they need. */
  private openAreaPicker(): void {
    if (this.phase !== 'idle' || this.modal) return;
    const rowH = 88;
    const m = (this.modal = new Modal(this, 150 + AREAS.length * rowH));
    const close = () => {
      m.destroy();
      this.modal = undefined;
    };
    m.text(GAME_WIDTH / 2, m.top + 30, 'Fishing spots', 26);
    m.text(GAME_WIDTH / 2, m.top + 60, 'Boats are built at the Boatyard', 14).setAlpha(0.8);
    let y = m.top + 112;
    for (const area of AREAS) {
      const owned = ownsArea(area);
      const here = area.id === this.area.id;
      m.text(36, y - 22, area.name, 18, 0).setAlpha(owned ? 1 : 0.7);
      m.text(36, y - 8, area.boat ? `${area.boat}: ${area.blurb}` : area.blurb, 13, 0)
        .setOrigin(0, 0)
        .setAlpha(0.75)
        .setWordWrapWidth(GAME_WIDTH - 180);
      const storm = stormBound() && area.id !== 'harbor';
      let label = here ? 'Here' : storm ? 'Storm' : 'Sail';
      if (!owned) label = boatUnlocked(area) ? `$${formatCoins(area.cost)}` : `Lv ${area.unlockLevel}`;
      const btn = makeButton(this, GAME_WIDTH - 80, y - 4, 100, 44, label, () => {
        if (owned && !here && !storm) {
          close();
          this.sail(area);
        }
      }, COLORS.primary, 17);
      btn.setEnabledLook(owned && !here && !storm, COLORS.primary);
      m.add(btn);
      if (!owned) m.text(GAME_WIDTH - 80, y + 26, boatUnlocked(area) ? 'at Boatyard' : 'town level', 11).setAlpha(0.6);
      y += rowH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', close, COLORS.neutral));
  }

  /** Logbook page for the current area. */
  private areaPage(): number {
    return AREAS.findIndex((a) => a.id === this.area.id);
  }

  private refreshAreaButton(): void {
    this.logbookButton.setVisible(this.phase === 'idle');
    this.barrelsButton.setVisible(this.phase === 'idle');
    this.barrelsButton.setLabel(`Barrels ${cratesUsed()}/${crateCapacity()}`);
    const show = this.phase === 'idle' && (state.boats.length > 0 || townLevel() >= 5);
    this.areaButton.setVisible(show);
    this.areaButton.setLabel(`Spot: ${this.area.name}`);
    for (const z of this.boatZones) if (z.input) z.input.enabled = this.phase === 'idle';
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

  private spawnHazards(): void {
    for (const h of this.hazards) h.sprite.destroy();
    this.hazards = [];
    const spawn = this.area.hazard;
    if (!spawn) return;
    const info = HAZARD_INFO[spawn.kind];
    for (let seg = spawn.minDepth; seg < this.area.depth; seg += 10) {
      const n = Math.floor(spawn.perTenM + Math.random());
      for (let i = 0; i < n; i++) {
        const x = Phaser.Math.Between(info.width / 2, GAME_WIDTH - info.width / 2);
        const y = SURFACE_Y + (seg + Math.random() * 10) * PX_PER_M;
        const speed = Phaser.Math.Between(info.speed[0], info.speed[1]);
        const vx = Math.random() < 0.5 ? -speed : speed;
        const sprite = this.add.image(x, y, `hazard-${spawn.kind}`).setDepth(6).setFlipX(vx < 0);
        this.hazards.push({ kind: spawn.kind, sprite, x, y, vx, seed: Math.random() * 1000, calmUntil: 0 });
      }
    }
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
    // A boat's winch lets out extra line, but the line never goes past the sea floor.
    this.stats.lineLength = Math.min(this.stats.lineLength + this.area.lineBonus, this.area.depth);
    this.sonar = sonarRange();
    for (const f of [...this.fish, ...this.caught]) f.sprite.destroy();
    this.fish = [];
    this.caught = [];
    this.stunnedUntil = 0;
    this.spawnFish();
    this.spawnHazards();

    this.hookX = HOOK_REST.x;
    this.hookY = HOOK_REST.y;
    this.targetX = null;
    this.cameras.main.scrollY = 0;

    this.promptText.setVisible(true);
    this.townButton.setVisible(true);
    this.todayText.setText(`Fish of the day: ${fishOfTheDay().name} +${WORLD.fishOfTheDayBonus * 100}%`).setVisible(true);
    const charms = ([
      ['Golden Lure', state.charms.goldenLure ?? 0],
      ['Voucher', state.charms.voucher ?? 0],
      ['Golden Net', state.charms.goldenNet ?? 0],
    ] as [string, number][]).filter(([, n]) => n > 0);
    this.charmsText.setText(charms.map(([name, n]) => `${name} ×${n}`).join(' · ')).setVisible(charms.length > 0);
    this.topBar.setSettingsVisible(true);
    this.hookText.setText('');
    this.refreshHud();
    this.refreshBaitButton();
    this.refreshAreaButton();
  }

  private cast(): void {
    this.phase = 'descending';
    consumeBait();
    this.baitButton.setVisible(false);
    this.refreshAreaButton();
    this.shieldsLeft = this.stats.shields;
    this.invulnerableUntil = 0;
    this.promptText.setVisible(false);
    this.townButton.setVisible(false);
    this.todayText.setVisible(false);
    this.charmsText.setVisible(false);
    // Merchant charms: the lure was already used to stock the water, the rest apply to this cast.
    if (this.fish.some((f) => f.type.legendary)) useCharm('goldenLure');
    if (useCharm('goldenNet')) this.stats.capacity += 3;
    sfx.cast();
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
    const fresh = new Set(this.caught.filter((f) => !discovered(f.type.id)).map((f) => f.type));
    const pagesBefore = completePages();
    for (const f of this.caught) {
      counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
      state.caught[f.type.id] = (state.caught[f.type.id] ?? 0) + 1;
    }
    questEvent({ type: 'cast', fish: this.caught.map((f) => f.type.id) });
    // Everything goes into the barrels; what doesn't fit is sold cheaply on the spot.
    const stowed = stowCatch(this.caught.map((f) => f.type));
    this.refreshHud();
    if (this.caught.length > 0) sfx.coins();
    for (const t of fresh) {
      if (t.legendary) {
        sfx.fanfare();
        showToast(this, `Legendary catch: ${t.name}!`);
        showToast(this, 'A trophy is ready to build in town');
      } else showToast(this, `New in the logbook: ${t.name}`);
    }
    for (const id of completePages()) {
      if (!pagesBefore.has(id)) showToast(this, `Logbook page done: ${AREAS.find((a) => a.id === id)!.name} +${Math.round(LOGBOOK_PAGE_BONUS * 100)}%`);
    }
    this.showResults(counts, stowed, fresh);
  }

  // --------------------------------------------------------------- Fish

  /** What a fish sells for right now. */
  private priceOf(type: FishType): number {
    return salePrice(type);
  }

  private spawnFish(): void {
    // The bait you're about to use is already in the water, luring fish.
    const bait = readyBait();
    const rain = projectDone('weatherStation') ? WORLD.rainFishStation : WORLD.rainFish;
    const density = this.area.density * (bait?.density ?? 1) * (weather() === 'rain' ? rain : 1);
    for (let seg = 0; seg < this.area.depth; seg += 10) {
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
    this.maybeSpawnLegend();
  }

  /** Now and then the area's legendary fish is down there, if the line can reach it. */
  private maybeSpawnLegend(): void {
    const type = legendOf(this.area.id);
    const lure = (state.charms.goldenLure ?? 0) > 0;
    const chance = lure ? 1 : LEGENDARY.chance + perkBonus('luckyCharm') + landmarkBonus('legendaryChance') + (isNight() ? WORLD.nightLegendaryChance : 0);
    if (!type || Math.random() >= chance || type.minDepth > this.stats.lineLength) return;
    const depth = Phaser.Math.Between(type.minDepth, Math.min(type.maxDepth, this.stats.lineLength - 5));
    const x = Phaser.Math.Between(60, GAME_WIDTH - 60);
    const y = SURFACE_Y + depth * PX_PER_M;
    const speed = Phaser.Math.Between(type.speed[0], type.speed[1]);
    const vx = Math.random() < 0.5 ? -speed : speed;
    const sprite = this.add.image(x, y, `fish-${type.id}`).setDepth(8).setFlipX(vx < 0);
    this.fish.push({ type, sprite, x, y, vx, seed: Math.random() * 1000, baseSpeed: speed, fleeUntil: 0 });
  }

  private pickFishType(depth: number, bait?: BaitDef): FishType | undefined {
    const options = FISH.filter((f) => f.area === this.area.id && !f.legendary && depth >= f.minDepth && depth <= f.maxDepth);
    // Pricier fish come out at night.
    const night = isNight() ? WORLD.nightRareWeight : 1;
    const weight = (f: FishType) => f.weight * (bait?.attract[f.id] ?? 1) * (f.value >= WORLD.nightRareValue ? night : 1);
    let roll = Math.random() * options.reduce((sum, f) => sum + weight(f), 0);
    for (const f of options) {
      roll -= weight(f);
      if (roll <= 0) return f;
    }
    return options[options.length - 1];
  }

  private updateHazards(dt: number, t: number): void {
    for (const h of this.hazards) {
      h.x += h.vx * dt;
      const half = h.sprite.width / 2;
      if (h.x < half && h.vx < 0) h.vx = -h.vx;
      if (h.x > GAME_WIDTH - half && h.vx > 0) h.vx = -h.vx;
      // Jellyfish pulse up and down; sharks and ice just drift.
      const bob = h.kind === 'jelly' ? Math.sin(t * 1.2 + h.seed) * 34 : Math.sin(t + h.seed) * 3;
      h.sprite.setPosition(h.x, h.y + bob);
      if (h.kind !== 'jelly') h.sprite.setFlipX(h.vx < 0);
    }
  }

  private hazardTouchingHook(): Hazard | undefined {
    for (const h of this.hazards) {
      const dx = h.sprite.x - this.hookX;
      const dy = h.sprite.y - this.hookY;
      const rx = h.sprite.width / 2 + HOOK_RADIUS * 0.5;
      const ry = h.sprite.height / 2 + HOOK_RADIUS * 0.5;
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return h;
    }
    return undefined;
  }

  /**
   * Bumping into a hazard. Sharks and ice stop the line on the way down; on the way up a shark
   * bites the lowest fish off the hook. Jellyfish sting either way, freezing your steering.
   * Returns true when the descent is over.
   */
  private hitHazard(h: Hazard, time: number): boolean {
    if (time < h.calmUntil || time < this.invulnerableUntil) return false;
    if (h.kind === 'jelly') {
      h.calmUntil = time + 1500;
      this.stunnedUntil = time + STING_SECONDS * 1000;
      this.cameras.main.shake(100, 0.005);
      this.popText('Stung!', '#e7b6f7');
      sfx.sting();
      return false;
    }
    if (this.phase === 'ascending') {
      if (h.kind !== 'shark' || this.caught.length === 0) return false;
      const lost = this.caught.pop()!;
      lost.sprite.destroy();
      h.calmUntil = time + 2500;
      h.vx = -h.vx * 1.4;
      this.cameras.main.shake(120, 0.006);
      this.popText(`Shark! −${lost.type.name}`, '#ff8a8a');
      sfx.bump();
      return false;
    }
    // Lucky Lure dodges a shark, but there's no dodging solid ice.
    if (h.kind === 'shark' && this.shieldsLeft > 0) {
      this.shieldsLeft--;
      this.invulnerableUntil = time + 700;
      h.calmUntil = time + 1000;
      this.cameras.main.shake(80, 0.004);
      return false;
    }
    h.calmUntil = time + 1500;
    this.cameras.main.shake(120, 0.006);
    this.popText(h.kind === 'ice' ? 'Ice!' : 'Shark!', '#ffffff');
    sfx.bump();
    return true;
  }

  private popText(text: string, color: string): void {
    const pop = makeText(this, this.hookX, this.hookY - 24, text, 18).setOrigin(0.5).setDepth(20).setColor(color);
    this.tweens.add({ targets: pop, y: pop.y - 50, alpha: 0, duration: 900, onComplete: () => pop.destroy() });
  }

  private updateFish(dt: number, t: number): void {
    const casting = this.phase === 'descending' || this.phase === 'ascending';
    for (const f of this.fish) {
      if (f.type.legendary) this.legendFlee(f, t, casting);
      f.x += f.vx * dt;
      const half = f.sprite.width / 2;
      if (f.x < half && f.vx < 0) f.vx = -f.vx;
      if (f.x > GAME_WIDTH - half && f.vx > 0) f.vx = -f.vx;
      const bob = f.type.erratic ? Math.sin(t * 2.5 + f.seed) * 18 : Math.sin(t * 1.5 + f.seed) * 3;
      f.sprite.setPosition(f.x, f.y + bob).setFlipX(f.vx < 0);
    }
  }

  /** A legendary fish darts away when the hook comes close, then calms back down. */
  private legendFlee(f: Fish, t: number, casting: boolean): void {
    const speed = f.baseSpeed ?? Math.abs(f.vx);
    if (t < (f.fleeUntil ?? 0)) return;
    const near = casting && Math.abs(f.sprite.x - this.hookX) < LEGENDARY.fleeRadius && Math.abs(f.sprite.y - this.hookY) < LEGENDARY.fleeRadius * 0.6;
    if (near) {
      // Away from the hook, unless that's into a wall.
      let dir = Math.sign(f.sprite.x - this.hookX) || 1;
      if ((dir < 0 && f.x < 50) || (dir > 0 && f.x > GAME_WIDTH - 50)) dir = -dir;
      f.vx = dir * LEGENDARY.fleeSpeed;
      f.fleeUntil = t + LEGENDARY.fleeSeconds;
    } else {
      f.vx = Math.sign(f.vx || 1) * speed;
    }
  }

  private fishTouchingHook(): Fish | undefined {
    for (const f of this.fish) {
      // Legendaries are too wary to bump into on the way down; you have to catch them going up.
      if (f.type.legendary && this.phase === 'descending') continue;
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

    sfx.catch(f.type.value);
    const pop = makeText(this, this.hookX, this.hookY - 20, `+$${this.priceOf(f.type)}`, 18).setOrigin(0.5).setDepth(20);
    pop.setColor('#ffe066');
    this.tweens.add({ targets: pop, y: pop.y - 50, alpha: 0, duration: 800, onComplete: () => pop.destroy() });
  }

  // --------------------------------------------------------------- Loop

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const t = time / 1000;
    tickEconomy();
    this.atmosphere.update(dt, time);
    for (const t of takeQuestToasts()) showToast(this, t);
    if (this.phase === 'idle' && !this.modal) this.modal = showOfflineEarnings(this, () => (this.modal = undefined));
    // A storm blowing in sends the boat home (between casts).
    if (this.phase === 'idle' && !this.modal && time - this.lastStormCheck > 1000) {
      this.lastStormCheck = time;
      this.drawSkyBody();
      if (currentArea().id !== this.area.id) {
        showToast(this, 'A storm! Your boat heads back to the harbor');
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart());
        this.lastStormCheck = Infinity;
      }
    }
    this.updateFish(dt, t);
    this.updateHazards(dt, t);

    const casting = this.phase === 'descending' || this.phase === 'ascending';
    if (casting && time >= this.stunnedUntil) this.steerHook(dt);
    if (casting) {
      const h = this.hazardTouchingHook();
      if (h && this.hitHazard(h, time) && this.phase === 'descending') this.startAscent();
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
          sfx.bump();
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
    this.updateDarkness();
    this.drawSonar(time);
    this.drawLegendGlow(time);
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
    for (const h of this.hazards) {
      const dy = h.sprite.y - this.hookY;
      if (Math.abs(dy) > rangePx || Math.abs(h.sprite.x - this.hookX) > h.sprite.width / 2 + 40) continue;
      g.lineStyle(3, 0xff5a5a, 0.4 + 0.5 * pulse).strokeEllipse(h.sprite.x, h.sprite.y, h.sprite.width + 16, h.sprite.height + 16);
    }
  }

  private drawLegendGlow(time: number): void {
    const g = this.glowGfx.clear();
    const pulse = 0.5 + 0.5 * Math.sin(time / 200);
    for (const f of [...this.fish, ...this.caught]) {
      if (!f.type.legendary) continue;
      const w = f.sprite.displayWidth;
      const h = f.sprite.displayHeight;
      g.fillStyle(0xffd166, 0.12 + 0.12 * pulse).fillEllipse(f.sprite.x, f.sprite.y, w + 30, h + 30);
      g.lineStyle(2, 0xffd166, 0.5 + 0.4 * pulse).strokeEllipse(f.sprite.x, f.sprite.y, w + 14, h + 14);
    }
  }

  /** Dark waters: the veil follows the hook and closes in as it sinks. */
  private updateDarkness(): void {
    if (!this.darkness) return;
    const depthM = (this.hookY - SURFACE_Y) / PX_PER_M;
    this.darkness.setPosition(this.hookX, this.hookY).setAlpha(Phaser.Math.Clamp((depthM - 15) / 60, 0, 0.97));
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
    if (time < this.stunnedUntil) this.hook.setTint(0xe7b6f7);
    else this.hook.clearTint();

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
      this.hookText.setText(this.stats.shields > 0 ? `Lure: ${this.shieldsLeft}/${this.stats.shields}` : '');
    } else if (this.phase === 'ascending') {
      const full = this.caught.length >= this.stats.capacity;
      this.hookText.setText(full ? 'Hook full!' : `Hook ${this.caught.length} / ${this.stats.capacity}`);
    }
  }

  // ----------------------------------------------------------------- UI

  /**
   * The catch, now in the barrels, with today's price for each fish. Sell this catch straight
   * away, or keep it and sell later (from the Barrels button) when prices suit you.
   */
  private showResults(counts: Map<FishType, number>, stowed: CatchResult, fresh: Set<FishType>): void {
    const rows = Math.max(1, counts.size);
    const over = [...stowed.overflow.values()].reduce((a, b) => a + b, 0);
    const m = (this.modal = new Modal(this, 236 + rows * 38 + (over > 0 ? 24 : 0)));
    const close = () => {
      m.destroy();
      this.modal = undefined;
      this.refreshHud();
      this.resetToDock();
    };

    m.text(GAME_WIDTH / 2, m.top + 36, counts.size > 0 ? 'Nice catch!' : 'Nothing this time', 28);
    if (this.area.id !== 'harbor') m.text(GAME_WIDTH / 2, m.top + 62, this.area.name, 13).setAlpha(0.6);
    let y = m.top + 96;
    if (counts.size === 0) m.text(GAME_WIDTH / 2, y, 'Steer into fish on the way up!', 18).setAlpha(0.8);
    let value = 0;
    for (const [type, n] of [...counts].sort((a, b) => b[0].value - a[0].value)) {
      const img = this.add.image(56, y, `fish-${type.id}`);
      m.add(img.setScale(Math.min(0.8, 52 / img.width)));
      if (fresh.has(type)) m.text(56, y + 14, 'NEW', 11).setColor('#8ee88e');
      else if (type.id === fishOfTheDay().id) m.text(56, y + 14, 'TODAY', 11).setColor(COLORS.gold);
      const name = m.text(92, y, `${type.name} ×${n}`, 16, 0);
      if (type.legendary) name.setColor(COLORS.gold);
      const price = this.priceOf(type);
      const factor = dailyFactor(type.id);
      const trend = factor >= 1.05 ? ' ^' : factor <= 0.95 ? ' v' : '';
      m.text(GAME_WIDTH - 44, y, `$${price}${trend}`, 16, 1).setColor(factor >= 1.05 ? '#8ee88e' : factor <= 0.95 ? '#ff8a8a' : '#ffffff');
      value += price * (stowed.kept.get(type) ?? 0);
      y += 38;
    }
    if (over > 0) {
      m.text(GAME_WIDTH / 2, y, `Barrels full: ${over} sold on the spot for $${formatCoins(stowed.overflowCoins)}`, 13).setColor('#ffb4a2');
      y += 24;
    }
    m.text(GAME_WIDTH / 2, y + 6, `Barrels ${cratesUsed()}/${crateCapacity()}`, 14).setAlpha(0.75);

    const btnY = m.top + m.height - 40;
    const sell = makeButton(this, GAME_WIDTH * 0.3, btnY, 160, 48, value > 0 ? `Sell $${formatCoins(value)}` : 'Sell', () => {
      const coins = sellFish([...stowed.kept].map(([type, n]) => [type.id, n]));
      if (coins > 0) showToast(this, `+$${formatCoins(coins)}`);
      close();
    }, COLORS.buy, 18);
    sell.setEnabledLook(value > 0, COLORS.buy);
    m.add(sell, makeButton(this, GAME_WIDTH * 0.7, btnY, 160, 48, 'Keep', close, COLORS.primary, 18));
  }
}

/** The fisher on the dock in a yellow oilskin, art pixels: left edge x, feet on y. */
function drawFisher(a: Art, x: number, feet: number): void {
  const b = feet;
  a.r(x + 3, b - 3, 4, 3, PAL.bark).r(x + 8, b - 3, 4, 3, PAL.bark);
  a.r(x + 3, b - 15, 4, 12, PAL.navy).r(x + 8, b - 15, 4, 12, PAL.navy).vl(x + 3, b - 15, 12, PAL.slate);
  a.r(x + 1, b - 31, 13, 17, PAL.amber).vl(x + 1, b - 31, 17, PAL.yellow).vl(x + 13, b - 31, 17, PAL.orange);
  a.d(x + 7, b - 27, PAL.orange).d(x + 7, b - 23, PAL.orange).d(x + 7, b - 19, PAL.orange);
  a.r(x + 12, b - 27, 6, 3, PAL.amber).hl(x + 12, b - 27, 6, PAL.yellow).r(x + 17, b - 27, 2, 3, PAL.skin);
  a.r(x + 3, b - 39, 9, 8, PAL.skin).d(x + 9, b - 36, PAL.ink);
  a.r(x + 3, b - 33, 9, 2, PAL.brown).d(x + 11, b - 34, PAL.brown);
  a.r(x + 2, b - 42, 11, 4, PAL.red).hl(x + 2, b - 39, 11, PAL.crimson).d(x + 7, b - 43, PAL.white);
}
