import Phaser from 'phaser';
import {
  AREAS,
  BAITS,
  RODS,
  FISH,
  FESTIVAL,
  PERKS,
  PERK_TIER_POINTS,
  PROJECTS,
  PROJECT_CHUNKS,
  FLEET,
  TRADE,
  type PerkBranch,
  BAIT_BY_ID,
  BUILDINGS,
  GAME_HEIGHT,
  ORDERS,
  QUESTS,
  GAME_WIDTH,
  GRID_X,
  ROWS_PER_EXPANSION,
  TILE,
  TOWN_COLS,
  UPGRADES,
  upgradeCost,
  FISH_PRICE_BONUS_PER_LEVEL,
  MAX_TOWN_LEVEL,
  TOWN_LEVELS,
  type BuildingDef,
} from '../config';
import { takeArrivals, tickEconomy } from '../economy';
import {
  averageHappiness,
  decorBonus,
  filletBoost,
  happinessByResident,
  homeMood,
  incomeMultiplier,
  incomePerWorkerOf,
  wagePerWorker,
  touchesRoad,
  workplaceIncome,
} from '../happiness';
import {
  chooseJob,
  defOf,
  tileGap,
  housingOf,
  isWorkplace,
  pinnedWorkers,
  jobSlots,
  residentsOf,
  staffTarget,
  unemployedCount,
  workerCounts,
  workersOf,
} from '../population';
import { state, type PlacedBuilding, type Resident } from '../state';
import { makeTextures } from '../textures';
import { addSprite, hasSprite, preloadSprites } from '../sprites';
import { CHIMNEYS, LIGHTHOUSE_LAMP, buildingTexture, festivalTexture, millWheelTexture, squareTexture } from '../art/buildings';
import { FOUNTAIN, LAMP_GLOW, decorTexture, fleetBoatTexture, jettyTexture, plinthTexture, rowboatTexture, tileIconTexture } from '../art/decor';
import { canalMouthTexture, groundImage, shoreImage, tileTexture } from '../art/ground';
import { badgeTexture, pipTexture } from '../art/icons';
import { PAL, pixImage } from '../pixel';
import { Villagers, makePerson, makePlayer } from './Villagers';
import { isWorking, touchesWater, wateredTiles } from '../water';
import { speciesCount } from '../logbook';
import { branchSpent, buyPerk, canBuyPerk, perkOpen, perkRank, pointSources, pointsEarned, pointsFree, resetPerks } from '../perks';
import { boatTime, canningRate, fleet, holdCapacity, holdCount, secondsToShip, shipCapacity, takeBoatReturns, takeShipVisits, tripSeconds } from '../trade';
import { ATMOSPHERE_DEPTH, Atmosphere } from '../atmosphere';
import { festivalActive, festivalCost, festivalMinutesLeft, hostFestival } from '../festival';
import { boughtThisVisit, buyItem, itemPrice, merchantHere, merchantMinutes, merchantStock } from '../merchant';
import { stockValue } from '../market';
import { fundProject, nextChunk, projectFunded, projectUnlocked } from '../projects';
import { sfx } from '../sound';
import {
  canDeliver,
  crateCapacity,
  cratesUsed,
  deliver,
  deliveryBoost,
  dropOrder,
  fishName,
  onIce,
  orderBuilding,
  orderTitle,
  ordersUnlocked,
  readyOrders,
  upgradeNeed,
} from '../crates';
import { hookBonus, marketBonus, millBoost, offlineCapHours, sonarRange } from '../services';
import {
  claimQuest,
  describeQuest,
  questProgress,
  questsUnlocked,
  swapCost,
  swapQuest,
  takeQuestToasts,
} from '../quests';
import {
  baitUnlocked,
  buyRod,
  ownsRod,
  rodUnlocked,
  boatUnlocked,
  boatyardOpen,
  buyBoat,
  ownsArea,
  buildCost,
  buyBait,
  buyUpgrade,
  canExpand,
  houseUpgradeBlockers,
  isUnlocked,
  levelCap,
  unlocksAt,
  canPlace,
  countCap,
  countOwned,
  expand,
  findFreeSpot,
  moveBuilding,
  nextExpansionCost,
  placeBuilding,
  placementProblem,
  sellBuilding,
  sellValue,
  sellsNow,
  setStaff,
  togglePriority,
  townLevel,
  townRows,
  upgradeBuilding,
  upgradeLevelCap,
} from '../town';
import {
  COLORS,
  Modal,
  TopBar,
  UI_DEPTH,
  fixToScreen,
  formatCoins,
  formatRate as fmtRate,
  makeButton,
  makeListRow,
  makeText,
  onTap,
  openLogbook,
  openMarket,
  openSettings,
  showOfflineEarnings,
  showToast,
  type Button,
} from '../ui';
import { canAfford } from '../dev';

// World layout: grid rows grow upward from y = 0; the shore and dock sit below it.
const SHORE_H = 40;
const WORLD_BOTTOM = 360;
const DOCK = { x: GRID_X + 6 * TILE + 6, y: SHORE_H - 10, w: 50, h: 230 };
/** Space above the last unlocked row for the expansion strip and some forest. */
const TOP_MARGIN = ROWS_PER_EXPANSION * TILE + 160;
const BOTTOM_BAR_H = 90;
const DRAG_THRESHOLD = 8;
/** How often workplaces show a floating "+$" for what they earned since the last one. */
const INCOME_POP_MS = 10_000;
const STATUS_CHECK_MS = 500;
const SMOKE_MS = 700;
/** Distance from the screen edge (px) where painting roads scrolls the town. */
const AUTOSCROLL_EDGE = 110;
const AUTOSCROLL_SPEED = 420;

type BuildTab = 'homes' | 'shops' | 'services' | 'decor' | 'special';

/** Workplaces that earn coins themselves (what the Water Mill boosts). */
const earns = (def: BuildingDef) => !!(def.incomePerWorker || def.speciesIncomePerWorker);

function tabOf(def: BuildingDef): BuildTab | undefined {
  if (def.menuTab === 'special') return 'special';
  if (def.category === 'housing') return 'homes';
  if (def.category === 'tile' || def.category === 'decor') return 'decor';
  if (def.category === 'work') return def.menuTab ?? 'shops';
  return undefined;
}

interface Paint {
  /** Erasing when the stroke started on a road, painting otherwise. */
  erase: boolean;
  lastCol: number;
  lastRow: number;
  /** Screen y of the finger, for edge auto-scroll. */
  screenY: number;
}

interface Gesture {
  startY: number;
  startScroll: number;
  moved: boolean;
  onGhost: boolean;
  /** Tile offset between the finger and the ghost's anchor tile when dragging the ghost. */
  grabCol: number;
  grabRow: number;
  lastY: number;
  lastTime: number;
}

interface Ghost {
  def: BuildingDef;
  col: number;
  row: number;
  view: Phaser.GameObjects.Container;
  outline: Phaser.GameObjects.Rectangle;
  /** Set when relocating an existing building instead of buying a new one. */
  moving?: PlacedBuilding;
}

/** What a building's view currently shows; redrawn when this changes. */
interface ViewStatus {
  level: number;
  unstaffed: boolean;
  /** Resident shown in the doorway of a staffed workplace. */
  keeper?: number;
  /** A waterside building that has lost its water. */
  dry?: boolean;
  /** Town Square: a festival is on. */
  festival?: boolean;
}

/** World-space top-left of a footprint whose bottom-left tile is (col, row). */
function tileToWorld(col: number, row: number, h: number): { x: number; y: number } {
  return { x: GRID_X + col * TILE, y: -(row + h) * TILE };
}

function worldToTile(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor((x - GRID_X) / TILE), row: Math.floor(-y / TILE) };
}


export class TownScene extends Phaser.Scene {
  private topBar!: TopBar;
  private ground?: Phaser.GameObjects.Image;
  private gridLines!: Phaser.GameObjects.Graphics;
  private expandButton?: Button;
  private buildingViews = new Map<number, Phaser.GameObjects.Container>();
  private viewStatus = new Map<number, ViewStatus>();

  private modal?: Modal;
  /** Building whose panel is open, so it can refresh when workers change. */
  private panelFor?: PlacedBuilding;
  private gesture?: Gesture;
  private velocity = 0;
  private ghost?: Ghost;

  private normalBar!: Phaser.GameObjects.Container;
  private buildBar!: Phaser.GameObjects.Container;
  private paintBar!: Phaser.GameObjects.Container;
  private placeButton!: Button;
  private cancelButton!: Button;
  private hint!: Phaser.GameObjects.Text;

  /** Hand-drawn tile sprites, on the same depth as tileGfx. */
  private tileImages!: Phaser.GameObjects.Container;
  private tileKey = '';
  /** The tile type (road or canal) being painted, while the paint tool is open. */
  private paintDef?: BuildingDef;
  private paint?: Paint;
  private rangeGfx!: Phaser.GameObjects.Graphics;
  private rangeLabels: Phaser.GameObjects.Text[] = [];
  private buildTab: BuildTab = 'homes';
  private villagers!: Villagers;
  private questButton!: Button;
  private questBadge!: Phaser.GameObjects.Container;
  private atmosphere!: Atmosphere;
  private merchantBoat?: Phaser.GameObjects.Container;
  /** The Fishing Wharf's boats, and their route along the canals out to sea. */
  private fleetBoats: Phaser.GameObjects.Image[] = [];
  private fleetRoute: { x: number; y: number }[] = [];
  private nightLights?: Phaser.GameObjects.Graphics;
  private questBadgeText!: Phaser.GameObjects.Text;

  constructor() {
    super('Town');
  }

  preload(): void {
    preloadSprites(this);
  }

  create(): void {
    this.buildingViews = new Map();
    this.viewStatus = new Map();
    this.modal = undefined;
    this.panelFor = undefined;
    this.gesture = undefined;
    this.ghost = undefined;
    this.velocity = 0;
    this.tileKey = '';
    this.paintDef = undefined;
    this.paint = undefined;
    this.rangeLabels = [];

    makeTextures(this);
    this.cameras.main.setBackgroundColor('#1b4332');
    this.ground = undefined;
    this.gridLines = this.add.graphics().setDepth(1);
    this.tileImages = this.add.container(0, 0).setDepth(2);
    this.rangeGfx = this.add.graphics().setDepth(35);
    this.drawShoreAndDock();
    this.rebuildGround();
    this.refreshBuildingViews();

    this.topBar = new TopBar(
      this,
      true,
      () => this.openSettingsMenu(),
      () => this.openResidents(),
    );
    this.createBottomBars();
    this.setupInput();

    const cam = this.cameras.main;
    cam.scrollY = WORLD_BOTTOM - GAME_HEIGHT;

    takeArrivals(); // Don't replay arrivals that happened while fishing.
    this.time.addEvent({ delay: INCOME_POP_MS, loop: true, callback: () => this.showIncomePops() });
    this.time.addEvent({ delay: STATUS_CHECK_MS, loop: true, callback: () => this.refreshBuildingViews() });
    this.time.addEvent({ delay: SMOKE_MS, loop: true, callback: () => this.puffSmoke() });
    this.villagers = new Villagers(this);
    this.atmosphere = new Atmosphere(this);
    // Lamps and windows glow through the night tint.
    this.nightLights = this.add.graphics().setDepth(ATMOSPHERE_DEPTH + 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.drawNightLights();
  }

  /** Warm light from lamp posts and windows once it gets dark. */
  private drawNightLights(): void {
    const g = this.nightLights?.clear();
    if (!g) return;
    const night = this.atmosphere.night;
    if (night <= 0.05) return;
    for (const b of state.buildings) {
      const def = defOf(b);
      if (def.category === 'tile') continue;
      const pos = tileToWorld(b.col, b.row, def.h);
      if (def.id === 'lampPost') {
        g.fillStyle(0xffd166, 0.1 * night).fillCircle(pos.x + TILE / 2, pos.y + 8, 30);
        g.fillStyle(0xffe8a3, 0.3 * night).fillCircle(pos.x + TILE / 2, pos.y + 8, 12);
      } else if (def.housing || def.jobs || def.category === 'player') {
        g.fillStyle(0xffc46b, 0.22 * night).fillEllipse(pos.x + (def.w * TILE) / 2, pos.y + def.h * TILE * 0.68, def.w * TILE * 0.7, def.h * TILE * 0.35);
      }
    }
  }

  update(time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    tickEconomy();
    this.atmosphere.update(dt, time);
    this.villagers.update(Math.min(deltaMs, 100), time);
    this.topBar.update();
    this.showArrivals();
    for (const t of takeQuestToasts()) showToast(this, t);
    for (const v of takeShipVisits()) this.sailShip(v.coins);
    this.updateFleet();
    this.refreshQuestButton();
    if (!this.modal) this.modal = showOfflineEarnings(this, () => (this.modal = undefined));

    if (!this.gesture && Math.abs(this.velocity) > 5) {
      this.scrollTo(this.cameras.main.scrollY - this.velocity * dt);
      this.velocity *= Math.exp(-dt * 4);
    }
    if (this.ghost) this.refreshGhost();
    if (this.paint) this.autoScrollPaint(dt);
    this.expandButton?.setEnabledLook(canAfford(nextExpansionCost()), COLORS.buy);
  }

  // ------------------------------------------------------------- World

  /**
   * The boats' way out: from the canal beside the Fishing Wharf, along filled canals to the
   * mouth in the bottom row, under the boardwalk and off to sea. Empty if there's no wharf.
   */
  private findFleetRoute(): { x: number; y: number }[] {
    const wharf = state.buildings.find((b) => b.type === 'fishingWharf');
    if (!wharf) return [];
    const def = defOf(wharf);
    const wet = wateredTiles();
    const key = (c: number, r: number) => `${c},${r}`;
    // Breadth-first from every wet tile touching the wharf to the nearest canal mouth (row 0).
    const prev = new Map<string, string | null>();
    const queue: [number, number][] = [];
    for (let c = wharf.col - 1; c <= wharf.col + def.w; c++) {
      for (let r = wharf.row - 1; r <= wharf.row + def.h; r++) {
        const inside = c >= wharf.col && c < wharf.col + def.w && r >= wharf.row && r < wharf.row + def.h;
        const corner = (c < wharf.col || c >= wharf.col + def.w) && (r < wharf.row || r >= wharf.row + def.h);
        if (inside || corner || !wet.has(key(c, r))) continue;
        prev.set(key(c, r), null);
        queue.push([c, r]);
      }
    }
    let end: string | undefined;
    while (queue.length > 0 && !end) {
      const [c, r] = queue.shift()!;
      if (r === 0) {
        end = key(c, r);
        break;
      }
      for (const [dc, dr] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
        const k = key(c + dc, r + dr);
        if (wet.has(k) && !prev.has(k)) {
          prev.set(k, key(c, r));
          queue.push([c + dc, r + dr]);
        }
      }
    }
    if (!end) return [];
    const tiles: string[] = [];
    for (let k: string | null | undefined = end; k; k = prev.get(k)) tiles.unshift(k);
    const points = tiles.map((k) => {
      const [c, r] = k.split(',').map(Number);
      const p = tileToWorld(c, r, 1);
      return { x: p.x + TILE / 2, y: p.y + TILE / 2 };
    });
    const mouth = points[points.length - 1];
    const seaSide = mouth.x < GAME_WIDTH / 2 ? -40 : GAME_WIDTH + 40;
    points.push({ x: mouth.x, y: SHORE_H + 60 }, { x: (mouth.x + seaSide) / 2, y: SHORE_H + 110 }, { x: seaSide, y: SHORE_H + 130 });
    return points;
  }

  /** A point a fraction 0..1 of the way along the route, and which way the boat faces there. */
  private alongRoute(frac: number): { x: number; y: number; angle: number } {
    const pts = this.fleetRoute;
    const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    let left = Phaser.Math.Clamp(frac, 0, 1) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (left <= lengths[i] || i === lengths.length - 1) {
        const t = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 0;
        const a = pts[i];
        const b = pts[i + 1];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      left -= lengths[i];
    }
    return { x: pts[0].x, y: pts[0].y, angle: 0 };
  }

  /**
   * Each boat waits by the wharf, sails out along the canals, is away fishing for a while, then
   * sails home the same way and unloads (one after another, so the canals stay lively).
   */
  private updateFleet(): void {
    const f = fleet();
    const boats = f && this.fleetRoute.length > 1 ? f.boats : 0;
    while (this.fleetBoats.length < boats) this.fleetBoats.push(this.add.image(0, 0, fleetBoatTexture(this)).setDepth(3));
    while (this.fleetBoats.length > boats) this.fleetBoats.pop()!.destroy();
    const T = tripSeconds();
    const S = FLEET.sailSeconds;
    const wait = 6;
    this.fleetBoats.forEach((boat, i) => {
      const t = boatTime(i, boats);
      let pos: { x: number; y: number; angle: number } | undefined;
      if (t < wait) pos = this.alongRoute(0);
      else if (t < wait + S) pos = this.alongRoute((t - wait) / S);
      else if (t > T - S) {
        pos = this.alongRoute((T - t) / S);
        pos.angle += Math.PI; // heading home
      }
      boat.setVisible(!!pos);
      if (pos) boat.setPosition(pos.x, pos.y + Math.sin(this.time.now / 400 + i) * 1.5).setRotation(pos.angle);
    });
    const wharf = f?.b;
    for (const r of takeBoatReturns()) if (wharf) this.floatText(wharf, `+${r.fish} fish`, 16, '#8ecae6');
  }

  /** A trade ship sails in past the pier, unloads its coins, and heads back out to sea. */
  private sailShip(coins: number): void {
    sfx.horn();
    const y = SHORE_H + 175;
    const g = pixImage(this, 'trade-ship', -62, -46, 124, 62, (p) => {
      p.fillStyle(PAL.slate).fillPoints([{ x: -60, y: -6 }, { x: 60, y: -6 }, { x: 48, y: 14 }, { x: -52, y: 14 }]);
      p.fillStyle(PAL.navy).fillRect(-56, 6, 110, 4);
      p.fillStyle(PAL.red).fillRect(-60, -6, 120, 4);
      [PAL.red, PAL.orange, PAL.green, PAL.amber, PAL.ocean].forEach((c, i) => p.fillStyle(c).fillRect(-46 + i * 16, -20, 14, 14));
      p.fillStyle(PAL.white).fillRect(30, -34, 22, 28);
      p.fillStyle(PAL.navy).fillRect(34, -30, 14, 6);
      p.fillStyle(PAL.slate).fillRect(38, -44, 6, 10);
      p.outline();
    });
    const ship = this.add.container(GAME_WIDTH + 80, y, [g]).setDepth(5);
    const stop = GAME_WIDTH * 0.72;
    this.tweens.add({
      targets: ship,
      x: stop,
      duration: 3500,
      ease: 'Sine.easeOut',
      onComplete: () => {
        const pop = makeText(this, stop, y - 50, `+$${formatCoins(coins)}`, 20).setOrigin(0.5).setColor(COLORS.gold).setDepth(6);
        this.tweens.add({ targets: pop, y: pop.y - 40, alpha: 0, delay: 600, duration: 1400, onComplete: () => pop.destroy() });
        this.tweens.add({ targets: ship, x: -100, delay: 2500, duration: 6000, ease: 'Sine.easeIn', onComplete: () => ship.destroy() });
      },
    });
    this.tweens.add({ targets: g, y: 2, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  private topY(): number {
    return Math.min(-townRows() * TILE - TOP_MARGIN, WORLD_BOTTOM - GAME_HEIGHT);
  }

  private scrollTo(y: number): void {
    const cam = this.cameras.main;
    cam.scrollY = Phaser.Math.Clamp(y, this.topY(), WORLD_BOTTOM - GAME_HEIGHT);
  }

  private rebuildGround(): void {
    const rows = townRows();
    const top = this.topY();
    this.ground?.destroy();
    this.ground = groundImage(this, 'ground', top, rows, canExpand() ? ROWS_PER_EXPANSION : 0, GRID_X).setDepth(0);

    this.expandButton?.destroy();
    this.expandButton = undefined;
    if (canExpand()) {
      const cost = nextExpansionCost();
      const y = -(rows + ROWS_PER_EXPANSION / 2) * TILE;
      this.expandButton = makeButton(this, GAME_WIDTH / 2, y, 250, 52, `Expand town  $${formatCoins(cost)}`, () => {
        if (expand()) this.rebuildGround();
      }, COLORS.buy, 20);
      this.expandButton.setDepth(3);
    }

    this.cameras.main.setBounds(0, top, GAME_WIDTH, WORLD_BOTTOM - top);
    this.drawGridLines();
  }

  /** Grid lines only show while placing, where precision matters. */
  private drawGridLines(): void {
    const g = this.gridLines.clear();
    if (!this.ghost && !this.paintDef) return;
    const rows = townRows();
    g.lineStyle(2, 0x000000, 0.14);
    for (let c = 0; c <= TOWN_COLS; c++) g.lineBetween(GRID_X + c * TILE, 0, GRID_X + c * TILE, -rows * TILE);
    for (let r = 0; r <= rows; r++) g.lineBetween(GRID_X, -r * TILE, GRID_X + TOWN_COLS * TILE, -r * TILE);
  }

  private drawShoreAndDock(): void {
    shoreImage(this, SHORE_H, WORLD_BOTTOM, DOCK).setDepth(0);
    const sign = makeText(this, DOCK.x + DOCK.w + 12, DOCK.y + 70, 'Go fishing ›', 18).setOrigin(0, 0.5);
    this.tweens.add({ targets: sign, x: sign.x + 6, duration: 600, yoyo: true, repeat: -1 });
  }

  // ---------------------------------------------------------- Buildings

  private drawBuilding(def: BuildingDef, status?: ViewStatus, placed?: PlacedBuilding): Phaser.GameObjects.Container {
    if (def.category === 'decor' || def.category === 'tile') return this.decorView(def, placed);
    if (def.id === 'lighthouse') return this.lighthouseView(def, status);
    if (def.festivals) return this.squareView(status);
    const pw = def.w * TILE;
    const ph = def.h * TILE;
    const parts: Phaser.GameObjects.GameObject[] = [this.artImage(def, placed?.id ?? 0)];
    if (def.id === 'playerHouse') parts.push(makePlayer(this).setPosition(pw / 2 + 18, ph - 4));
    if (def.id === 'waterMill') {
      // The wheel turns while millers are at work.
      const wheel = this.add.image(15, ph - 15, millWheelTexture(this));
      if (status?.keeper !== undefined && !status.dry) this.tweens.add({ targets: wheel, angle: 360, duration: 4000, repeat: -1 });
      parts.push(wheel);
    }
    if (status) parts.push(...this.statusParts(def, status, { x: 10, y: 10, keeper: true }));
    return this.add.container(0, 0, parts);
  }

  /**
   * A building's picture: your own sprite from assets/sprites/<id>.png when there is one
   * (16 px per tile, bottom-left on the footprint), otherwise the built-in pixel art.
   */
  private artImage(def: BuildingDef, variant: number): Phaser.GameObjects.Image {
    if (hasSprite(this, def.id)) return addSprite(this, def.id, 0, def.h * TILE).setOrigin(0, 1);
    const t = buildingTexture(this, def, variant);
    return this.add.image(t.x, t.y, t.key).setOrigin(0);
  }

  /** Level badge, shopkeeper in the doorway and the "!" marker, for a building's view. */
  private statusParts(def: BuildingDef, status: ViewStatus, at: { x: number; y: number; keeper: boolean }): Phaser.GameObjects.GameObject[] {
    const pw = def.w * TILE;
    const ph = def.h * TILE;
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (def.maxLevel > 1) {
      parts.push(this.add.image(pw - at.x, at.y, badgeTexture(this)));
      parts.push(makeText(this, pw - at.x, at.y, `${status.level}`, 12).setOrigin(0.5));
    }
    if (at.keeper && status.keeper !== undefined) {
      // Shopkeeper waiting in the doorway, shifting their weight now and then.
      const keeper = makePerson(this, status.keeper).setPosition(pw / 2 + 13, ph - 5);
      this.tweens.add({ targets: keeper, scaleY: 1.06, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1 });
      parts.push(keeper);
    }
    // Blue: a waterside building cut off from the water. Red: "help wanted", nobody works here.
    if (status.dry || status.unstaffed) {
      const pip = this.add.image(at.x, at.y, pipTexture(this, status.dry ? 'blue' : 'red'));
      const mark = makeText(this, at.x, at.y, '!', 13).setOrigin(0.5);
      this.tweens.add({ targets: [pip, mark], scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
      parts.push(pip, mark);
    }
    return parts;
  }

  /** A striped tower with a lamp room whose beam sweeps while keepers are on duty. */
  private lighthouseView(def: BuildingDef, status?: ViewStatus): Phaser.GameObjects.Container {
    const parts: Phaser.GameObjects.GameObject[] = [this.artImage(def, 0)];
    if (status?.keeper !== undefined) {
      const beam = this.add.triangle(LIGHTHOUSE_LAMP.x, LIGHTHOUSE_LAMP.y, 0, 0, 70, -10, 70, 10, 0xfee761, 0.35).setOrigin(0, 0.5);
      this.tweens.add({ targets: beam, scaleX: -1, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      parts.push(beam);
    }
    if (status) parts.push(...this.statusParts(def, status, { x: 6, y: 34, keeper: false }));
    return this.add.container(0, 0, parts);
  }

  /** Decor with its little bit of life: glowing lamps, a bubbling fountain. */
  private decorView(def: BuildingDef, placed?: PlacedBuilding): Phaser.GameObjects.Container {
    if (def.id === 'mooredBoats') return this.boatView(placed);
    if (def.trophy) return this.trophyView(def.trophy);
    const view = this.add.container(0, 0, [this.decorImage(def)]);
    if (def.id === 'lampPost') {
      const glow = this.add.circle(LAMP_GLOW.x, LAMP_GLOW.y, 13, 0xfee761, 0.18);
      view.addAt(glow, 0);
      this.tweens.add({ targets: glow, alpha: 0.45, scale: 1.25, duration: 1400 + Math.random() * 600, yoyo: true, repeat: -1 });
    }
    if (def.id === 'fountain') {
      const spout = this.add.rectangle(FOUNTAIN.spoutX, FOUNTAIN.spoutY, 4, 4, 0xffffff);
      const ripple = this.add.ellipse(FOUNTAIN.spoutX, FOUNTAIN.poolY, 18, 10).setStrokeStyle(2, 0xffffff, 0.6);
      view.add([ripple, spout]);
      this.tweens.add({ targets: spout, y: FOUNTAIN.spoutY - 6, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.tweens.add({ targets: ripple, scale: 2.1, alpha: 0, duration: 1600, repeat: -1 });
    }
    return view;
  }

  /** Decoration or tile icon: your own sprite when there is one, otherwise the pixel art. */
  private decorImage(def: BuildingDef): Phaser.GameObjects.Image {
    if (hasSprite(this, def.id)) {
      const img = addSprite(this, def.id, 0, def.h * TILE).setOrigin(0, 1);
      return def.category === 'tile' ? img.setOrigin(0).setPosition(0, 0).setDisplaySize(TILE, TILE) : img;
    }
    const t = def.category === 'tile' ? tileIconTexture(this, def.id) : decorTexture(this, def);
    return this.add.image(t.x, t.y, t.key).setOrigin(0);
  }

  /** Paved plaza with a bandstand; bunting, stalls and confetti while a festival is on. */
  private squareView(status?: ViewStatus): Phaser.GameObjects.Container {
    const s = TILE * 4;
    const sq = squareTexture(this);
    const parts: Phaser.GameObjects.GameObject[] = [this.add.image(sq.x, sq.y, sq.key).setOrigin(0)];
    if (status?.festival) {
      const f = festivalTexture(this);
      parts.push(this.add.image(f.x, f.y, f.key).setOrigin(0));
      // Confetti drifting down over the square
      const colors = [0xe43b44, 0xfee761, 0x63c74d, 0x0099db, 0xf77622];
      for (let i = 0; i < 10; i++) {
        const bit = this.add.rectangle(10 + Math.random() * (s - 20), 0, 4, 4, colors[i % colors.length]);
        this.tweens.add({ targets: bit, y: s - 10, x: bit.x + 10, angle: 360, duration: 2000 + Math.random() * 1500, delay: Math.random() * 2000, repeat: -1 });
        parts.push(bit);
      }
    }
    return this.add.container(0, 0, parts);
  }

  /** A stone plinth with the legendary fish mounted on top, glinting. */
  private trophyView(fishId: string): Phaser.GameObjects.Container {
    const s = TILE * 2;
    const pl = plinthTexture(this);
    const plinth = this.add.image(pl.x, pl.y, pl.key).setOrigin(0);
    const type = FISH.find((f) => f.id === fishId)!;
    const fish = this.add.image(s / 2, 18, `fish-${fishId}`).setScale(type.width * 1.6 > s - 8 ? 0.5 : 1);
    const shine = this.add.rectangle(s / 2 + 12, 10, 4, 4, 0xffffff);
    this.tweens.add({ targets: shine, alpha: 0, scale: 0.5, duration: 700, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: fish, y: fish.y - 2, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return this.add.container(0, 0, [plinth, fish, shine]);
  }

  /**
   * A rowboat tied up beside a little jetty. When placed, the jetty sits on this tile and the
   * boat floats on the neighbouring canal tile.
   */
  private boatView(placed?: PlacedBuilding): Phaser.GameObjects.Container {
    let dx = 0;
    let dy = 0;
    if (placed) {
      const wet = wateredTiles();
      const dirs: [number, number, number, number][] = [[1, 0, 1, 0], [-1, 0, -1, 0], [0, 1, 0, -1], [0, -1, 0, 1]];
      const hit = dirs.find(([dc, dr]) => wet.has(`${placed.col + dc},${placed.row + dr}`));
      if (hit) [dx, dy] = [hit[2], hit[3]];
    }
    const j = jettyTexture(this);
    const jetty = this.add.image(j.x, j.y, j.key).setOrigin(0);
    const boat = this.add.image(0, 0, rowboatTexture(this));
    boat.setPosition(TILE / 2 + dx * TILE * 0.75, TILE / 2 + dy * TILE * 0.75);
    if (dy !== 0) boat.setAngle(90);
    this.tweens.add({ targets: boat, y: boat.y + 2, duration: 1300 + Math.random() * 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return this.add.container(0, 0, placed ? [jetty, boat] : [boat.setPosition(TILE / 2, TILE / 2)]);
  }

  private addBuildingView(b: PlacedBuilding, status: ViewStatus): void {
    const def = defOf(b);
    this.buildingViews.get(b.id)?.destroy();
    const view = this.drawBuilding(def, status, b);
    const pos = tileToWorld(b.col, b.row, def.h);
    // Lower rows draw in front so tall roofs overlap neatly.
    view.setPosition(pos.x, pos.y).setDepth(10 + (1000 - b.row) * 0.001);
    if (this.ghost?.moving === b) view.setAlpha(0.3);
    this.buildingViews.set(b.id, view);
    this.viewStatus.set(b.id, status);
  }

  /** Redraws any building whose level or staffing changed, and drops views of removed ones. */
  private refreshBuildingViews(): void {
    if (this.nightLights) this.drawNightLights();
    this.refreshMerchantBoat();
    this.fleetRoute = this.findFleetRoute();
    const counts = workerCounts();
    const wet = wateredTiles();
    const alive = new Set<number>();
    this.drawTiles();
    for (const b of state.buildings) {
      if (defOf(b).category === 'tile') continue;
      alive.add(b.id);
      const keeper = jobSlots(b) > 0 ? state.residents.find((r) => r.job === b.id)?.id : undefined;
      const dry = !!defOf(b).needsWater && !touchesWater(b, wet);
      const festival = !!defOf(b).festivals && festivalActive();
      const status: ViewStatus = { level: b.level, unstaffed: jobSlots(b) > 0 && !counts.get(b.id), keeper, dry, festival };
      const old = this.viewStatus.get(b.id);
      const view = this.buildingViews.get(b.id);
      const changed =
        !old || old.level !== status.level || old.unstaffed !== status.unstaffed || old.keeper !== keeper || old.festival !== festival;
      if (!view || changed || old.dry !== dry) {
        this.addBuildingView(b, status);
      } else {
        // Keep the position current (cheap, and covers moves).
        const pos = tileToWorld(b.col, b.row, defOf(b).h);
        view.setPosition(pos.x, pos.y);
      }
    }
    for (const [id, view] of this.buildingViews) {
      if (!alive.has(id)) {
        view.destroy();
        this.buildingViews.delete(id);
        this.viewStatus.delete(id);
      }
    }
  }

  /**
   * Roads, canals and bridges, one image per tile, picked to join up with their neighbours.
   * Canals joined to the sea are water; the rest are dry ditches. A road.png in assets/sprites
   * replaces the built-in road tiles.
   */
  private drawTiles(): void {
    const tiles = state.buildings.filter((b) => defOf(b).category === 'tile');
    const wet = wateredTiles();
    const key = tiles.map((t) => `${t.type}${t.col},${t.row}${wet.has(`${t.col},${t.row}`) ? 'w' : ''}`).join('|');
    if (key === this.tileKey) return;
    this.tileKey = key;
    this.tileImages.removeAll(true);
    const at = (...types: string[]) => new Set(tiles.filter((t) => types.includes(t.type)).map((t) => `${t.col},${t.row}`));
    // Bridges carry the road over the water, so they join both.
    const roads = at('road', 'bridge');
    const water = at('canal', 'bridge');
    const canals = at('canal');
    const ownRoad = hasSprite(this, 'road');

    for (const t of tiles) {
      const p = tileToWorld(t.col, t.row, 1);
      const here = `${t.col},${t.row}`;
      const same = t.type === 'road' ? roads : water;
      const edges = {
        n: same.has(`${t.col},${t.row + 1}`),
        s: same.has(`${t.col},${t.row - 1}`),
        e: same.has(`${t.col + 1},${t.row}`),
        w: same.has(`${t.col - 1},${t.row}`),
      };
      if (t.type === 'road' && ownRoad) {
        this.tileImages.add(addSprite(this, 'road', p.x, p.y).setDisplaySize(TILE, TILE));
        continue;
      }
      let tex: string;
      if (t.type === 'road') tex = tileTexture(this, 'road', edges);
      else if (t.type === 'canal') {
        // A canal in the bottom row cuts through the boardwalk into the sea.
        if (t.row === 0) {
          edges.s = true;
          this.tileImages.add(this.add.image(p.x, p.y + TILE, canalMouthTexture(this, SHORE_H)).setOrigin(0));
        }
        tex = tileTexture(this, 'canal', edges, { wet: wet.has(here) });
      } else {
        // A canal flowing left-right is crossed up-down, and vice versa.
        const sideways = canals.has(`${t.col - 1},${t.row}`) || canals.has(`${t.col + 1},${t.row}`);
        const near = [here, `${t.col - 1},${t.row}`, `${t.col + 1},${t.row}`, `${t.col},${t.row - 1}`, `${t.col},${t.row + 1}`];
        tex = tileTexture(this, 'bridge', edges, { sideways, wet: near.some((k) => wet.has(k)) });
      }
      this.tileImages.add(this.add.image(p.x, p.y, tex).setOrigin(0));
    }
  }

  /** Chimney top in building-local px, for homes. */
  private chimneyOf(def: BuildingDef): { x: number; y: number } | undefined {
    return CHIMNEYS[def.id];
  }

  /** Smoke rises from the chimneys of homes where somebody lives. */
  private puffSmoke(): void {
    const occupied = new Set(state.residents.map((r) => r.home));
    for (const b of state.buildings) {
      const chimney = this.chimneyOf(defOf(b));
      // Homes smoke while lived in; the bathhouse steams while it's staffed.
      const lived = occupied.has(b.id) || b.type === 'playerHouse' || (b.type === 'bathhouse' && state.residents.some((r) => r.job === b.id));
      if (!chimney || !lived || !this.isOnScreen(b) || Math.random() < 0.4) continue;
      if (this.ghost?.moving === b) continue;
      const pos = tileToWorld(b.col, b.row, defOf(b).h);
      const puff = this.add.rectangle(pos.x + chimney.x, pos.y + chimney.y - 2, 6, 6, 0xc0cbdc, 0.75).setDepth(30);
      this.tweens.add({
        targets: puff,
        y: puff.y - 30,
        x: puff.x + Phaser.Math.Between(-6, 6),
        scale: 2.4,
        alpha: 0,
        duration: 2200,
        onComplete: () => puff.destroy(),
      });
    }
  }

  private buildingAt(col: number, row: number): PlacedBuilding | undefined {
    return state.buildings.find((b) => {
      const def = defOf(b);
      return col >= b.col && col < b.col + def.w && row >= b.row && row < b.row + def.h;
    });
  }

  private isOnScreen(b: PlacedBuilding): boolean {
    const cam = this.cameras.main;
    const def = defOf(b);
    const pos = tileToWorld(b.col, b.row, def.h);
    return pos.y < cam.scrollY + GAME_HEIGHT && pos.y + def.h * TILE > cam.scrollY;
  }

  private floatText(b: PlacedBuilding, text: string, size: number, color: string): void {
    const def = defOf(b);
    const pos = tileToWorld(b.col, b.row, def.h);
    const pop = makeText(this, pos.x + (def.w * TILE) / 2, pos.y + 8, text, size).setOrigin(0.5).setDepth(50);
    pop.setColor(color);
    // Keep labels on screen for buildings at the edges.
    pop.setX(Phaser.Math.Clamp(pop.x, pop.width / 2 + 4, GAME_WIDTH - pop.width / 2 - 4));
    this.tweens.add({ targets: pop, y: pop.y - 36, alpha: 0, duration: 1600, onComplete: () => pop.destroy() });
  }

  private showIncomePops(): void {
    if (this.modal) return;
    const moods = happinessByResident();
    for (const b of state.buildings) {
      const amount = (workplaceIncome(b, moods) / 60) * (INCOME_POP_MS / 1000);
      if (amount <= 0 || !this.isOnScreen(b)) continue;
      this.floatText(b, `+$${amount < 10 ? amount.toFixed(1) : formatCoins(amount)}`, 15, COLORS.gold);
    }
  }

  private showArrivals(): void {
    const arrived = takeArrivals();
    if (arrived.length === 0) return;
    for (const r of arrived) {
      const home = state.buildings.find((b) => b.id === r.home);
      if (home && this.isOnScreen(home)) this.floatText(home, `${r.name} moved in`, 14, '#ffffff');
    }
    if (this.panelFor) this.openBuildingPanel(this.panelFor);
  }

  // --------------------------------------------------------------- Input

  private setupInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.gesture = undefined;
      if (this.modal || over.length > 0) return;
      if (this.paintDef) {
        // A second finger turns the stroke into a scroll.
        if (this.twoFingers()) {
          this.paint = undefined;
          return;
        }
        this.startPaint(p);
        return;
      }
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const tile = worldToTile(w.x, w.y);
      const g = this.ghost;
      const onGhost =
        !!g && tile.col >= g.col && tile.col < g.col + g.def.w && tile.row >= g.row && tile.row < g.row + g.def.h;
      this.velocity = 0;
      this.gesture = {
        startY: p.y,
        startScroll: this.cameras.main.scrollY,
        moved: false,
        onGhost,
        grabCol: g ? tile.col - g.col : 0,
        grabRow: g ? tile.row - g.row : 0,
        lastY: p.y,
        lastTime: performance.now(),
      };
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.paintDef && p.isDown) {
        if (this.twoFingers()) this.scrollTo(this.cameras.main.scrollY - (p.y - p.prevPosition.y));
        else if (this.paint) this.continuePaint(p);
        return;
      }
      const gs = this.gesture;
      if (!gs || !p.isDown) return;
      if (Math.abs(p.y - gs.startY) > DRAG_THRESHOLD || Math.abs(p.x - p.downX) > DRAG_THRESHOLD) gs.moved = true;
      if (!gs.moved) return;

      if (gs.onGhost && this.ghost) {
        const w = this.cameras.main.getWorldPoint(p.x, p.y);
        const tile = worldToTile(w.x, w.y);
        this.moveGhost(tile.col - gs.grabCol, tile.row - gs.grabRow);
        return;
      }
      this.scrollTo(gs.startScroll - (p.y - gs.startY));
      const now = performance.now();
      const dt = Math.max(1, now - gs.lastTime) / 1000;
      this.velocity = 0.7 * this.velocity + 0.3 * ((p.y - gs.lastY) / dt);
      gs.lastY = p.y;
      gs.lastTime = now;
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.paintDef) {
        this.paint = undefined;
        return;
      }
      const gs = this.gesture;
      this.gesture = undefined;
      if (!gs) return;
      if (gs.moved) {
        // Only fling if the finger was still moving when it lifted.
        if (gs.onGhost || performance.now() - gs.lastTime > 80) this.velocity = 0;
        return;
      }
      this.velocity = 0;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      this.handleTap(w.x, w.y);
    });
  }

  private handleTap(x: number, y: number): void {
    if (this.ghost) {
      // Center the footprint on the finger.
      const { def } = this.ghost;
      this.moveGhost(Math.round((x - GRID_X) / TILE - def.w / 2), Math.round(-y / TILE - def.h / 2));
      return;
    }
    const tile = worldToTile(x, y);
    const b = this.buildingAt(tile.col, tile.row);
    if (b && defOf(b).category !== 'tile' && tile.col >= 0 && tile.col < TOWN_COLS && tile.row >= 0) {
      this.openBuildingPanel(b);
      return;
    }
    if (x >= DOCK.x - 30 && x <= DOCK.x + DOCK.w + 130 && y >= DOCK.y && y <= DOCK.y + DOCK.h) {
      this.scene.start('Fishing');
    }
  }

  // ---------------------------------------------------------- Build mode

  private createBottomBars(): void {
    const y = GAME_HEIGHT - BOTTOM_BAR_H / 2 - 6;
    const bg = () =>
      this.add.container(0, 0, [
        this.add.rectangle(0, GAME_HEIGHT - BOTTOM_BAR_H, GAME_WIDTH, BOTTOM_BAR_H, COLORS.panel, 0.85).setOrigin(0),
        this.add.rectangle(0, GAME_HEIGHT - BOTTOM_BAR_H - 2, GAME_WIDTH, 2, COLORS.ink).setOrigin(0),
      ]);

    this.questButton = makeButton(this, GAME_WIDTH / 2, y, 132, 56, 'Quests', () => this.openQuests(), COLORS.buy, 20);
    // Red badge with the number of quests ready to claim.
    this.questBadgeText = makeText(this, 0, 0, '', 13).setOrigin(0.5);
    this.questBadge = this.add.container(GAME_WIDTH / 2 + 58, y - 26, [
      this.add.image(0, 0, pipTexture(this, 'red')),
      this.questBadgeText,
    ]);
    this.normalBar = this.add.container(0, 0, [
      bg(),
      makeButton(this, GAME_WIDTH * 0.17, y, 132, 56, 'Build', () => this.openBuildMenu(), COLORS.primary, 20),
      this.questButton,
      this.questBadge,
      makeButton(this, GAME_WIDTH * 0.83, y, 132, 56, 'Go Fish', () => this.scene.start('Fishing'), COLORS.neutral, 20),
    ]);
    this.placeButton = makeButton(this, GAME_WIDTH * 0.72, y, 180, 56, 'Place', () => this.confirmPlacement(), COLORS.buy);
    this.cancelButton = makeButton(this, GAME_WIDTH * 0.28, y, 180, 56, 'Cancel', () => this.exitBuildMode(), COLORS.danger);
    this.buildBar = this.add.container(0, 0, [bg(), this.cancelButton, this.placeButton]);
    this.paintBar = this.add.container(0, 0, [
      bg(),
      makeButton(this, GAME_WIDTH / 2, y, 200, 56, 'Done', () => this.exitPaintMode(), COLORS.neutral),
    ]);
    this.hint = makeText(this, GAME_WIDTH / 2, GAME_HEIGHT - BOTTOM_BAR_H - 26, 'Tap or drag to choose a spot', 16).setOrigin(0.5);
    this.hint.setAlign('center');

    for (const o of [this.normalBar, this.buildBar, this.paintBar, this.hint]) fixToScreen(o).setDepth(UI_DEPTH);
    this.buildBar.setVisible(false);
    this.paintBar.setVisible(false);
    this.hint.setVisible(false);
  }

  private enterBuildMode(def: BuildingDef, moving?: PlacedBuilding): void {
    const view = this.drawBuilding(def).setAlpha(0.75);
    const outline = this.add.rectangle(0, 0, def.w * TILE, def.h * TILE).setOrigin(0).setStrokeStyle(3, 0xffffff);
    view.add(outline);
    view.setDepth(40);
    this.ghost = { def, col: 0, row: 0, view, outline, moving };
    // Leave a faint copy where the building stands now.
    if (moving) this.buildingViews.get(moving.id)?.setAlpha(0.3);

    const cam = this.cameras.main;
    const centerRow = worldToTile(0, cam.scrollY + GAME_HEIGHT / 2).row;
    const spot = moving ? { col: moving.col, row: moving.row } : (findFreeSpot(def, centerRow) ?? { col: 0, row: 0 });
    this.moveGhost(spot.col, spot.row);
    const pos = tileToWorld(spot.col, spot.row, def.h);
    this.scrollTo(pos.y + (def.h * TILE) / 2 - GAME_HEIGHT / 2);

    // Decorations are placed in batches, so the left button just ends the session.
    const batch = def.category === 'decor' && !moving;
    this.cancelButton.setLabel(batch ? 'Done' : 'Cancel');
    this.cancelButton.setEnabledLook(true, batch ? COLORS.neutral : COLORS.danger);
    this.normalBar.setVisible(false);
    this.buildBar.setVisible(true);
    this.hint.setVisible(true);
    this.drawGridLines();
    this.updateRangePreview();
  }

  private exitBuildMode(): void {
    const moving = this.ghost?.moving;
    if (moving) this.buildingViews.get(moving.id)?.setAlpha(1);
    this.ghost?.view.destroy();
    this.ghost = undefined;
    this.clearRangePreview();
    this.normalBar.setVisible(true);
    this.buildBar.setVisible(false);
    this.hint.setVisible(false);
    this.drawGridLines();
  }

  private moveGhost(col: number, row: number): void {
    const g = this.ghost;
    if (!g) return;
    g.col = Phaser.Math.Clamp(col, 0, TOWN_COLS - g.def.w);
    g.row = Phaser.Math.Clamp(row, 0, townRows() - g.def.h);
    const pos = tileToWorld(g.col, g.row, g.def.h);
    g.view.setPosition(pos.x, pos.y);
    this.updateRangePreview();
  }

  private clearRangePreview(): void {
    this.rangeGfx.clear();
    for (const t of this.rangeLabels) t.destroy();
    this.rangeLabels = [];
  }

  /**
   * While placing: decorations light up their area and show "+N" on the homes they'd cheer up;
   * homes show the mood they'd have on this spot.
   */
  private updateRangePreview(): void {
    this.clearRangePreview();
    const g = this.ghost;
    if (!g) return;
    const probe: PlacedBuilding = { id: -1, type: g.def.id, col: g.col, row: g.row, level: 1 };
    const label = (b: PlacedBuilding, text: string, color: string) => {
      const def = defOf(b);
      const pos = tileToWorld(b.col, b.row, def.h);
      const t = makeText(this, pos.x + (def.w * TILE) / 2, pos.y + (def.h * TILE) / 2, text, 15)
        .setOrigin(0.5)
        .setDepth(45)
        .setColor(color);
      this.rangeLabels.push(t);
    };

    // Decorations and Taverns both cheer up homes in a square around them.
    const tavern = g.def.moodPerWorker;
    const effect = g.def.happiness ?? (tavern && { amount: tavern.amount(g.moving?.level ?? 1), radius: tavern.radius });
    if (effect) {
      const r = effect.radius;
      const c0 = Math.max(0, g.col - r);
      const r0 = Math.max(0, g.row - r);
      const c1 = Math.min(TOWN_COLS, g.col + g.def.w + r);
      const r1 = Math.min(townRows(), g.row + g.def.h + r);
      const tl = tileToWorld(c0, r0, r1 - r0);
      this.rangeGfx.fillStyle(0xffe066, 0.13).fillRect(tl.x, tl.y, (c1 - c0) * TILE, (r1 - r0) * TILE);
      this.rangeGfx.lineStyle(2, 0xffe066, 0.7).strokeRect(tl.x, tl.y, (c1 - c0) * TILE, (r1 - r0) * TILE);
      for (const home of state.buildings) {
        if (home === g.moving || !defOf(home).housing) continue;
        const inRange = tileGap(probe, home) <= r;
        if (tavern && inRange) label(home, `+${effect.amount}/worker`, COLORS.gold);
        else if (!tavern && inRange) label(home, `+${decorBonus(probe, home)}`, COLORS.gold);
      }
    }
    const mill = g.def.millPerWorker;
    if (mill) {
      const r = mill.radius;
      const c0 = Math.max(0, g.col - r);
      const r0 = Math.max(0, g.row - r);
      const c1 = Math.min(TOWN_COLS, g.col + g.def.w + r);
      const r1 = Math.min(townRows(), g.row + g.def.h + r);
      const tl = tileToWorld(c0, r0, r1 - r0);
      this.rangeGfx.fillStyle(0x8ecae6, 0.13).fillRect(tl.x, tl.y, (c1 - c0) * TILE, (r1 - r0) * TILE);
      this.rangeGfx.lineStyle(2, 0x8ecae6, 0.7).strokeRect(tl.x, tl.y, (c1 - c0) * TILE, (r1 - r0) * TILE);
      for (const w of state.buildings) {
        if (w !== g.moving && earns(defOf(w)) && tileGap(probe, w) <= r) label(w, `+${mill.amount * 100}%/worker`, '#8ecae6');
      }
    }
    if (g.def.housing) {
      const mood = homeMood(probe);
      label(probe, `Mood ${Math.round(Math.min(100, mood.total + 10))}%`, '#ffffff');
    }
  }

  // ------------------------------------------- Paint tool (roads, canals)

  private twoFingers(): boolean {
    return this.input.pointer1.isDown && this.input.pointer2.isDown;
  }

  private enterPaintMode(def: BuildingDef): void {
    this.paintDef = def;
    this.normalBar.setVisible(false);
    this.paintBar.setVisible(true);
    const noun = def.name.toLowerCase();
    const tip = def.id === 'canal' ? 'Connect to the shore to fill with water' : 'Two fingers to scroll';
    this.hint.setText(`Drag to paint ${noun}s · start on one to erase\n${tip}`).setVisible(true);
    this.drawGridLines();
  }

  private exitPaintMode(): void {
    this.paintDef = undefined;
    this.paint = undefined;
    this.normalBar.setVisible(true);
    this.paintBar.setVisible(false);
    this.hint.setVisible(false);
    this.drawGridLines();
  }

  private tileUnder(screenX: number, screenY: number): { col: number; row: number } {
    const w = this.cameras.main.getWorldPoint(screenX, screenY);
    return worldToTile(w.x, w.y);
  }

  /** The painted tile of the current kind at a spot, if any. */
  private paintedAt(col: number, row: number): PlacedBuilding | undefined {
    return state.buildings.find((b) => b.type === this.paintDef?.id && b.col === col && b.row === row);
  }

  private startPaint(p: Phaser.Input.Pointer): void {
    const t = this.tileUnder(p.x, p.y);
    this.paint = { erase: !!this.paintedAt(t.col, t.row), lastCol: t.col, lastRow: t.row, screenY: p.y };
    this.paintTile(t.col, t.row);
  }

  private continuePaint(p: Phaser.Input.Pointer): void {
    this.paint!.screenY = p.y;
    this.paintTo(this.tileUnder(p.x, p.y));
  }

  /** Paints every tile on the line from the last painted tile, so fast swipes leave no gaps. */
  private paintTo(t: { col: number; row: number }): void {
    const paint = this.paint!;
    let { lastCol: c, lastRow: r } = paint;
    while (c !== t.col || r !== t.row) {
      // Step along the longer axis first: gives clean L-free diagonals as stairs.
      if (Math.abs(t.col - c) >= Math.abs(t.row - r)) c += Math.sign(t.col - c);
      else r += Math.sign(t.row - r);
      this.paintTile(c, r);
    }
    paint.lastCol = t.col;
    paint.lastRow = t.row;
  }

  private paintTile(col: number, row: number): void {
    const def = this.paintDef;
    if (!def || col < 0 || col >= TOWN_COLS || row < 0 || row >= townRows()) return;
    const existing = this.paintedAt(col, row);
    if (this.paint?.erase) {
      if (existing) sellBuilding(existing);
    } else if (!existing) {
      const problem = placementProblem(def, col, row);
      if (problem === 'noCanal') this.hint.setText('Bridges go over canals');
      // Occupied tiles are skipped quietly, so a stroke can pass over buildings.
      if (problem) return;
      if (!placeBuilding(def, col, row)) {
        this.hint.setText(`Not enough coins (${def.name.toLowerCase()}s cost $${def.baseCost})`);
        return;
      }
    }
    this.drawTiles();
  }

  /** Scrolls while the finger rests near the top or bottom edge, and keeps painting under it. */
  private autoScrollPaint(dt: number): void {
    const paint = this.paint!;
    const top = 44 + AUTOSCROLL_EDGE;
    const bottom = GAME_HEIGHT - BOTTOM_BAR_H - AUTOSCROLL_EDGE / 2;
    let dir = 0;
    if (paint.screenY < top) dir = -1;
    else if (paint.screenY > bottom) dir = 1;
    if (dir === 0) return;
    const before = this.cameras.main.scrollY;
    this.scrollTo(before + dir * AUTOSCROLL_SPEED * dt);
    if (this.cameras.main.scrollY !== before) {
      const p = this.input.activePointer;
      this.paintTo(this.tileUnder(p.x, p.y));
    }
  }

  private refreshGhost(): void {
    const g = this.ghost!;
    const cost = g.moving ? 0 : buildCost(g.def);
    const fits = canPlace(g.def, g.col, g.row, g.moving);
    const ok = fits && canAfford(cost);
    g.outline.setStrokeStyle(3, fits ? 0x7cfc9a : 0xff5a5a).setFillStyle(fits ? 0x7cfc9a : 0xff5a5a, 0.25);
    this.placeButton.setEnabledLook(ok, COLORS.buy);
    this.placeButton.setLabel(g.moving ? 'Move here' : `Place $${formatCoins(cost)}`);
    const problem = placementProblem(g.def, g.col, g.row, g.moving);
    this.hint.setText(
      !problem ? 'Tap or drag to choose a spot' : problem === 'water' ? 'Must be next to water (a filled canal)' : 'That spot is taken',
    );
  }

  private confirmPlacement(): void {
    const g = this.ghost;
    if (!g) return;
    if (g.moving) {
      if (!moveBuilding(g.moving, g.col, g.row)) return;
      this.exitBuildMode();
      this.refreshBuildingViews();
      return;
    }
    const b = placeBuilding(g.def, g.col, g.row);
    if (!b) return;
    sfx.place();
    // Decorations stay in build mode so you can dot several around town.
    if (g.def.category !== 'decor') this.exitBuildMode();
    else this.updateRangePreview();
    this.refreshBuildingViews();
    const view = this.buildingViews.get(b.id)!;
    view.setScale(0.8);
    this.tweens.add({ targets: view, scale: 1, duration: 250, ease: 'Back.Out' });
  }

  // -------------------------------------------------------------- Panels

  // ------------------------------------------------------------ Residents

  /** "Fish Stand", or "Fish Stand #2" when there's more than one. */
  private buildingLabel(b: PlacedBuilding): string {
    const same = state.buildings.filter((x) => x.type === b.type).sort((a, z) => a.id - z.id);
    const def = defOf(b);
    return same.length > 1 ? `${def.name} #${same.indexOf(b) + 1}` : def.name;
  }

  private leaveModes(): void {
    if (this.ghost) this.exitBuildMode();
    if (this.paintDef) this.exitPaintMode();
    this.closeModal();
  }

  /** Paged list layout shared by the residents list and the job picker. */
  private pagedModal(title: string, subtitle: string, count: number, rowH: number, page: number) {
    const height = Math.min(GAME_HEIGHT - 110, 780);
    const perPage = Math.max(1, Math.floor((height - 230) / rowH));
    const pages = Math.max(1, Math.ceil(count / perPage));
    const p = Math.min(page, pages - 1);
    const m = (this.modal = new Modal(this, height));
    m.text(GAME_WIDTH / 2, m.top + 30, title, 26);
    m.text(GAME_WIDTH / 2, m.top + 62, subtitle, 14).setAlpha(0.8);
    return { m, from: p * perPage, to: Math.min(count, (p + 1) * perPage), page: p, pages, firstY: m.top + 100 + rowH / 2 };
  }

  private pageControls(m: Modal, page: number, pages: number, go: (p: number) => void, onClose: () => void, closeLabel = 'Close'): void {
    const y = m.top + m.height - 92;
    if (pages > 1) {
      const prev = makeButton(this, GAME_WIDTH * 0.22, y, 110, 42, '‹ Prev', () => page > 0 && go(page - 1), COLORS.neutral, 17);
      const next = makeButton(this, GAME_WIDTH * 0.78, y, 110, 42, 'Next ›', () => page < pages - 1 && go(page + 1), COLORS.neutral, 17);
      prev.setEnabledLook(page > 0, COLORS.neutral);
      next.setEnabledLook(page < pages - 1, COLORS.neutral);
      m.add(prev, next);
      m.text(GAME_WIDTH / 2, y, `${page + 1} / ${pages}`, 16).setAlpha(0.8);
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, closeLabel, onClose, COLORS.neutral));
  }

  /** Everyone in town: name, job and mood. Tap someone to choose where they work. */
  private openResidents(page = 0): void {
    this.leaveModes();
    const residents = [...state.residents].sort((a, z) => a.name.localeCompare(z.name));
    const jobless = residents.filter((r) => r.job === null).length;
    const subtitle = residents.length === 0 ? 'Build homes and people will move in.' : `${residents.length} residents · ${jobless} without a job`;
    const rowH = 58;
    const list = this.pagedModal('Residents', subtitle, residents.length, rowH, page);
    const { m } = list;
    const moods = happinessByResident();

    let y = list.firstY;
    for (const r of residents.slice(list.from, list.to)) {
      const row = makeListRow(this, y, rowH, () => this.openJobPicker(r, list.page));
      const work = state.buildings.find((b) => b.id === r.job);
      const home = state.buildings.find((b) => b.id === r.home);
      row.add(makePerson(this, r.id).setPosition(56, y + 12));
      row.add(makeText(this, 80, y - 10, r.name, 18).setOrigin(0, 0.5));
      const jobText = work ? this.buildingLabel(work) : 'No job';
      // Keep it to one line: hand-picked jobs say so, which leaves less room for the home.
      const homeText = home ? (r.pinned ? ` · ${this.buildingLabel(home)}` : ` · lives in ${this.buildingLabel(home)}`) : '';
      const detail = `${jobText}${r.pinned ? ' (set by you)' : ''}${homeText}`;
      row.add(makeText(this, 80, y + 13, detail, 13).setOrigin(0, 0.5).setColor(work ? COLORS.gold : '#ff8a8a'));
      const mood = Math.round(moods.get(r.id) ?? 50);
      const moodColor = mood >= 65 ? '#8ee88e' : mood < 35 ? '#ff8a8a' : '#ffffff';
      row.add(makeText(this, GAME_WIDTH - 44, y - 8, `${mood}%`, 16).setOrigin(1, 0.5).setColor(moodColor));
      row.add(makeText(this, GAME_WIDTH - 44, y + 13, '›', 18).setOrigin(1, 0.5).setAlpha(0.6));
      m.add(row);
      y += rowH;
    }
    this.pageControls(m, list.page, list.pages, (p) => this.openResidents(p), () => this.closeModal());
  }

  /** Where should this resident work? Auto, no job, or any workplace with room. */
  private openJobPicker(r: Resident, backPage: number, page = 0): void {
    this.closeModal();
    type Option = { label: string; sub: string; job: number | null | 'auto'; ok: boolean; current: boolean };
    const counts = workerCounts();
    const options: Option[] = [
      { label: 'Auto', sub: 'Let the town decide', job: 'auto', ok: true, current: !r.pinned },
      { label: 'No job', sub: 'Stay at home', job: null, ok: true, current: !!r.pinned && r.job === null },
    ];
    const workplaces = state.buildings.filter(isWorkplace).sort((a, z) => a.type.localeCompare(z.type) || a.id - z.id);
    for (const b of workplaces) {
      const slots = jobSlots(b);
      const here = r.job === b.id;
      const full = !here && pinnedWorkers(b) >= slots;
      const sub = full ? 'Full (all picked by you)' : `Workers ${counts.get(b.id) ?? 0}/${slots}`;
      options.push({ label: this.buildingLabel(b), sub, job: b.id, ok: !full, current: !!r.pinned && here });
    }

    const rowH = 54;
    const list = this.pagedModal(`Job for ${r.name}`, 'Hand-picked jobs stay put', options.length, rowH, page);
    const { m } = list;
    let y = list.firstY;
    for (const o of options.slice(list.from, list.to)) {
      const pick = () => {
        if (chooseJob(r, o.job)) this.openResidents(backPage);
      };
      const row = makeListRow(this, y, rowH, o.ok ? pick : null, o.current);
      row.add(makeText(this, 48, y - 9, o.label, 17).setOrigin(0, 0.5).setAlpha(o.ok ? 1 : 0.5));
      row.add(makeText(this, 48, y + 12, o.sub, 13).setOrigin(0, 0.5).setAlpha(0.7));
      if (o.current) row.add(makeText(this, GAME_WIDTH - 44, y, 'Now', 16).setOrigin(1, 0.5).setColor('#63c74d'));
      m.add(row);
      y += rowH;
    }
    this.pageControls(m, list.page, list.pages, (p) => this.openJobPicker(r, backPage, p), () => this.openResidents(backPage), 'Back');
  }

  // --------------------------------------------------------------- Quests

  private refreshQuestButton(): void {
    const unlocked = questsUnlocked();
    this.questButton.setEnabledLook(unlocked, COLORS.buy);
    const ready = state.quests.filter((q) => q.done).length + readyOrders();
    this.questBadge.setVisible(unlocked && ready > 0);
    this.questBadgeText.setText(`${ready}`);
  }

  /** Quests / Orders tabs at the top of the board. */
  private boardTabs(m: Modal, current: 'quests' | 'orders'): void {
    const tabs: ['quests' | 'orders', string][] = [['quests', 'Quests'], ['orders', 'Orders']];
    tabs.forEach(([id, label], i) => {
      const n = id === 'quests' ? state.quests.filter((q) => q.done).length : readyOrders();
      const btn = makeButton(this, GAME_WIDTH / 2 + (i - 0.5) * 140, m.top + 34, 130, 40, n > 0 ? `${label} (${n})` : label, () => {
        if (id === 'quests') this.openQuests();
        else this.openOrders();
      }, COLORS.primary, 17);
      btn.setEnabledLook(id === current, COLORS.primary);
      m.add(btn);
    });
  }

  /** The quest board: progress, rewards, and Claim / Swap buttons. */
  private openQuests(): void {
    if (!questsUnlocked()) {
      showToast(this, `Quests unlock at house level ${QUESTS.unlockLevel}`);
      return;
    }
    this.leaveModes();
    const cardH = 118;
    const m = (this.modal = new Modal(this, 150 + Math.max(1, state.quests.length) * cardH));
    this.boardTabs(m, 'quests');
    m.text(GAME_WIDTH / 2, m.top + 70, 'Finish quests for coins and bait', 14).setAlpha(0.8);
    if (state.quests.length === 0) m.text(GAME_WIDTH / 2, m.top + 110, 'New quests are on their way!', 16).setAlpha(0.8);

    let y = m.top + 92;
    for (const q of state.quests) {
      const progress = Math.min(q.amount, questProgress(q));
      const card = this.add.rectangle(GAME_WIDTH / 2, y + cardH / 2 - 4, GAME_WIDTH - 64, cardH - 12, COLORS.card).setStrokeStyle(2, COLORS.ink);
      if (q.done) card.setStrokeStyle(2, 0x8ee88e);
      else if (q.daily) card.setStrokeStyle(2, 0xffd166);
      m.add(card);
      m.text(46, y + 18, describeQuest(q), 17, 0);

      // Progress bar
      const barW = 210;
      const frac = q.amount > 0 ? progress / q.amount : 1;
      m.add(this.add.rectangle(46, y + 48, barW, 14, COLORS.track).setOrigin(0, 0.5));
      m.add(this.add.rectangle(46, y + 48, Math.max(2, barW * frac), 14, q.done ? COLORS.complete : COLORS.progress).setOrigin(0, 0.5));
      const unit = q.kind === 'earnFishing' ? '$' : '';
      const suffix = q.kind === 'happiness' ? '%' : '';
      m.text(46 + barW + 8, y + 48, `${unit}${progress}${suffix}/${unit}${q.amount}${suffix}`, 13, 0).setAlpha(0.85);

      const reward = [`$${formatCoins(q.reward.coins)}`];
      if (q.reward.bait) reward.push(`${q.reward.bait.count} ${BAIT_BY_ID[q.reward.bait.id].name}`);
      m.text(46, y + 78, `Reward: ${reward.join(' + ')}`, 14, 0).setColor(COLORS.gold);

      const btnX = GAME_WIDTH - 86;
      if (q.done) {
        m.add(makeButton(this, btnX, y + 76, 100, 40, 'Claim', () => {
          if (claimQuest(q)) {
            showToast(this, `+$${formatCoins(q.reward.coins)}`);
            this.openQuests();
          }
        }, COLORS.buy, 18));
      } else if (q.daily) {
        m.text(btnX, y + 76, 'Today only', 13).setColor(COLORS.gold);
      } else {
        const cost = swapCost();
        const swap = makeButton(this, btnX, y + 76, 100, 36, `Swap $${cost}`, () => {
          if (swapQuest(q)) this.openQuests();
        }, COLORS.neutral, 14);
        swap.setEnabledLook(canAfford(cost), COLORS.neutral);
        m.add(swap);
      }
      y += cardH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral));
  }

  /** Orders from shops: fish from your barrels for coins and a lasting income boost. */
  private openOrders(): void {
    this.leaveModes();
    const cardH = 118;
    const unlocked = ordersUnlocked();
    const m = (this.modal = new Modal(this, 170 + Math.max(1, state.orders.length) * cardH));
    this.boardTabs(m, 'orders');
    const sub = !unlocked
      ? `Orders start at house level ${ORDERS.unlockLevel}`
      : `Each delivery: +${ORDERS.boostPerDelivery * 100}% income there, for good · Barrels ${cratesUsed()}/${crateCapacity()}`;
    m.text(GAME_WIDTH / 2, m.top + 70, sub, 13).setAlpha(0.8).setWordWrapWidth(GAME_WIDTH - 70).setAlign('center');
    if (unlocked && state.orders.length === 0) m.text(GAME_WIDTH / 2, m.top + 120, 'No orders right now. Check back soon!', 16).setAlpha(0.8);

    let y = m.top + 100;
    for (const o of state.orders) {
      const have = Math.min(o.amount, onIce(o.fish));
      const ready = canDeliver(o);
      const card = this.add.rectangle(GAME_WIDTH / 2, y + cardH / 2 - 4, GAME_WIDTH - 64, cardH - 12, COLORS.card).setStrokeStyle(2, COLORS.ink);
      if (ready) card.setStrokeStyle(2, 0x8ee88e);
      m.add(card);
      m.text(46, y + 18, orderTitle(o), 16, 0).setWordWrapWidth(GAME_WIDTH - 100);
      const barW = 210;
      m.add(this.add.rectangle(46, y + 48, barW, 14, COLORS.track).setOrigin(0, 0.5));
      m.add(this.add.rectangle(46, y + 48, Math.max(2, (barW * have) / o.amount), 14, ready ? COLORS.complete : COLORS.progress).setOrigin(0, 0.5));
      m.text(46 + barW + 8, y + 48, `${have}/${o.amount} on ice`, 13, 0).setAlpha(0.85);
      const b = orderBuilding(o);
      const boost = b ? ` + ${b ? defOf(b).name : ''} +${ORDERS.boostPerDelivery * 100}%` : '';
      m.text(46, y + 78, `$${formatCoins(o.coins)}${boost}`, 14, 0).setColor(COLORS.gold);
      const btnX = GAME_WIDTH - 86;
      if (ready) {
        m.add(makeButton(this, btnX, y + 76, 100, 40, 'Deliver', () => {
          if (deliver(o)) {
            showToast(this, `Delivered! +$${formatCoins(o.coins)}`);
            this.refreshBuildingViews();
            this.openOrders();
          }
        }, COLORS.buy, 18));
      } else {
        m.add(makeButton(this, btnX, y + 76, 100, 36, 'Drop', () => {
          dropOrder(o);
          this.openOrders();
        }, COLORS.neutral, 14));
      }
      y += cardH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral));
  }

  /** Town projects: pay a chunk at a time; each finished project has a lasting effect. */
  private openProjects(square: PlacedBuilding): void {
    this.closeModal();
    this.panelFor = undefined;
    const cardH = 106;
    const m = (this.modal = new Modal(this, 150 + PROJECTS.length * cardH));
    m.text(GAME_WIDTH / 2, m.top + 30, 'Town projects', 26);
    m.text(GAME_WIDTH / 2, m.top + 60, `Paid in ${PROJECT_CHUNKS} parts · works for good once built`, 13).setAlpha(0.8);
    let y = m.top + 92;
    for (const p of PROJECTS) {
      const funded = projectFunded(p);
      const done = funded >= p.cost;
      const open = projectUnlocked(p);
      const card = this.add.rectangle(GAME_WIDTH / 2, y + cardH / 2 - 4, GAME_WIDTH - 64, cardH - 10, COLORS.card).setStrokeStyle(2, COLORS.ink);
      if (done) card.setStrokeStyle(2, 0x8ee88e);
      m.add(card);
      m.text(46, y + 14, p.name, 17, 0).setAlpha(open ? 1 : 0.6);
      m.text(46, y + 26, p.effect, 13, 0).setOrigin(0, 0).setColor(COLORS.gold).setWordWrapWidth(GAME_WIDTH - 200);
      const barW = 200;
      m.add(this.add.rectangle(46, y + 78, barW, 12, COLORS.track).setOrigin(0, 0.5));
      m.add(this.add.rectangle(46, y + 78, Math.max(2, (barW * funded) / p.cost), 12, done ? COLORS.complete : COLORS.progress).setOrigin(0, 0.5));
      m.text(46 + barW + 8, y + 78, `$${formatCoins(funded)}/$${formatCoins(p.cost)}`, 12, 0).setAlpha(0.8);
      const btnX = GAME_WIDTH - 86;
      if (done) m.text(btnX, y + 24, 'Built!', 16).setColor('#8ee88e');
      else if (!open) m.text(btnX, y + 24, `House Lv ${p.unlockLevel}`, 14).setColor('#ffb4a2');
      else {
        const chunk = nextChunk(p);
        const btn = makeButton(this, btnX, y + 24, 100, 40, `$${formatCoins(chunk)}`, () => {
          if (fundProject(p)) {
            sfx.place();
            if (projectFunded(p) >= p.cost) {
              sfx.fanfare();
              showToast(this, `${p.name} built!`);
            }
            this.openProjects(square);
          }
        }, COLORS.buy, 16);
        btn.setEnabledLook(canAfford(chunk), COLORS.buy);
        m.add(btn);
      }
      y += cardH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Back', () => this.openBuildingPanel(square), COLORS.neutral));
  }

  /** The traveling merchant's goods for this visit (one of each). */
  private openMerchant(): void {
    this.leaveModes();
    const stock = merchantStock();
    const cardH = 96;
    const m = (this.modal = new Modal(this, 160 + stock.length * cardH));
    m.text(GAME_WIDTH / 2, m.top + 30, 'Traveling merchant', 26);
    m.text(GAME_WIDTH / 2, m.top + 60, merchantHere() ? `Sails on in ${merchantMinutes()} min · new goods every visit` : 'Gone for now', 13).setAlpha(0.8);
    let y = m.top + 92;
    for (const item of stock) {
      const price = itemPrice(item);
      const got = boughtThisVisit(item);
      m.add(this.add.rectangle(GAME_WIDTH / 2, y + cardH / 2 - 4, GAME_WIDTH - 64, cardH - 10, 0x68386c).setStrokeStyle(2, 0xb55088));
      m.text(46, y + 16, item.name, 18, 0).setColor('#e7b6f7');
      m.text(46, y + 40, item.description, 13, 0).setOrigin(0, 0).setWordWrapWidth(GAME_WIDTH - 200).setAlpha(0.85);
      const btn = makeButton(this, GAME_WIDTH - 86, y + 40, 110, 44, got ? 'Bought' : `$${formatCoins(price)}`, () => {
        if (buyItem(item)) {
          sfx.coins();
          showToast(this, item.charges ? `${item.name}: ready on your next cast` : `${item.name} bought!`);
          this.openMerchant();
        }
      }, COLORS.buy, 17);
      btn.setEnabledLook(!got && merchantHere() && canAfford(price), COLORS.buy);
      m.add(btn);
      y += cardH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral));
  }

  /** The merchant's boat at the pier while they're in town; tap it to shop. */
  private refreshMerchantBoat(): void {
    const here = merchantHere();
    if (here && !this.merchantBoat) {
      const g = pixImage(this, 'merchant-boat', -42, -52, 84, 66, (p) => {
        p.fillStyle(PAL.plum).fillPoints([{ x: -40, y: -4 }, { x: 40, y: -4 }, { x: 30, y: 12 }, { x: -34, y: 12 }]);
        p.fillStyle(PAL.amber).fillRect(-40, -4, 80, 4);
        p.lineStyle(2, PAL.brown).lineBetween(0, -4, 0, -50);
        p.fillStyle(PAL.white).fillTriangle(2, -48, 2, -10, 30, -10);
        p.fillStyle(PAL.magenta).fillTriangle(-2, -44, -2, -10, -24, -10);
        p.outline();
      });
      const label = makeText(this, 0, -66, 'Merchant ›', 15).setOrigin(0.5).setColor('#e7b6f7');
      const boat = this.add.container(DOCK.x - 70, SHORE_H + 90, [g, label]).setDepth(5).setSize(90, 90);
      this.tweens.add({ targets: g, y: 2, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      onTap(boat, () => {
        if (!this.modal) this.openMerchant();
      });
      this.merchantBoat = boat;
    } else if (!here && this.merchantBoat) {
      this.merchantBoat.destroy();
      this.merchantBoat = undefined;
    }
  }

  private openSettingsMenu(): void {
    this.leaveModes();
    openSettings(this, (m) => (this.modal = m));
  }

  private closeModal(): void {
    this.modal?.destroy();
    this.modal = undefined;
    this.panelFor = undefined;
  }

  private openBuildMenu(tab = this.buildTab, page = 0): void {
    this.closeModal();
    this.buildTab = tab;
    const all = BUILDINGS.filter((d) => tabOf(d) === tab);
    const rowH = 112;
    // Page the list when a tab has more rows than fit on short screens.
    const fit = Math.max(1, Math.floor((GAME_HEIGHT - 110 - 230) / rowH));
    const pages = Math.ceil(all.length / fit);
    const p = Math.min(page, pages - 1);
    const defs = all.slice(p * fit, (p + 1) * fit);
    const m = (this.modal = new Modal(this, 170 + defs.length * rowH + (pages > 1 ? 60 : 0)));
    m.text(GAME_WIDTH / 2, m.top + 30, 'Build', 26);

    const tabs: [BuildTab, string][] = [
      ['homes', 'Homes'],
      ['shops', 'Shops'],
      ['services', 'Services'],
      ['decor', 'Decor'],
      ['special', 'Special'],
    ];
    tabs.forEach(([id, label], i) => {
      const x = GAME_WIDTH / 2 + (i - 2) * 80;
      const btn = makeButton(this, x, m.top + 72, 76, 40, label, () => this.openBuildMenu(id), COLORS.primary, 13);
      btn.setEnabledLook(id === tab, COLORS.primary);
      m.add(btn);
    });

    let y = m.top + 146;
    for (const def of defs) {
      const owned = countOwned(def.id);
      const cost = buildCost(def);
      const cap = countCap(def);
      const maxed = owned >= cap;
      // At the limit for this town level, but more are allowed after a house upgrade.
      const levelLimited = maxed && cap < def.maxCount;
      // Scaled by a whole factor or a half, so the pixel art stays even.
      const preview = this.drawBuilding(def).setScale(2 / Math.max(def.w, def.h));
      preview.setPosition(36, y - 32);
      m.add(preview);
      m.text(110, y - 40, def.name, 18, 0);
      m.text(110, y - 20, this.buildSummary(def), 13, 0).setColor(COLORS.gold);
      m.text(110, y - 10, def.description, 13, 0).setOrigin(0, 0).setWordWrapWidth(212).setAlpha(0.8);
      const unlocked = isUnlocked(def);
      // Trophies wait for their legendary fish rather than a house level.
      const needsFish = !!def.trophy && !unlocked;
      const fromMerchant = !!def.merchantOnly && cap === 0;
      const water = def.needsWater ? ' · needs water' : '';
      // One footnote per row, the most important one.
      let note: { text: string; color: string; alpha?: number } | undefined;
      if (fromMerchant) note = { text: 'Sold by the traveling merchant', color: '#e7b6f7' };
      else if (!unlocked) {
        const why = needsFish ? `Catch the legendary ${FISH.find((f) => f.id === def.trophy)!.name}` : `Unlocks at house level ${def.unlockLevel}`;
        note = { text: why, color: '#ffb4a2' };
      } else if (levelLimited) note = { text: `Owned ${owned}/${cap} · more at house Lv ${townLevel() + 1}`, color: '#ffb4a2' };
      else if (def.maxCount > 1 && def.category !== 'tile' && def.category !== 'decor') {
        note = { text: `Owned ${owned}/${cap}${water}`, color: water ? '#8ecae6' : '#ffffff', alpha: water ? 1 : 0.6 };
      } else if (water) note = { text: 'Needs water (beside a canal)', color: '#8ecae6' };
      if (note) m.text(110, y + 42, note.text, 12, 0).setColor(note.color).setAlpha(note.alpha ?? 1);
      if (!unlocked) preview.setAlpha(0.35);
      const affordable = canAfford(cost);
      const label = fromMerchant ? 'Merchant' : needsFish ? 'Catch' : !unlocked ? `Lv ${def.unlockLevel}` : maxed ? (def.maxCount === 1 ? 'Built' : 'Max') : cost === 0 ? 'Place' : `$${formatCoins(cost)}`;
      const btn = makeButton(this, GAME_WIDTH - 72, y, 88, 46, label, () => {
        if (!unlocked || maxed || !affordable) return;
        this.closeModal();
        if (def.category === 'tile') this.enterPaintMode(def);
        else this.enterBuildMode(def);
      }, COLORS.buy, 18);
      btn.setEnabledLook(unlocked && !maxed && affordable, COLORS.buy);
      m.add(btn);
      y += rowH;
    }
    this.pageControls(m, p, pages, (np) => this.openBuildMenu(tab, np), () => this.closeModal());
  }

  /** Short stats line for the build menu, e.g. "1 job · $6/min each". */
  private buildSummary(def: BuildingDef): string {
    const size = `${def.w}×${def.h}`;
    if (def.housing) return `${size} · ${def.housing(1)} residents`;
    if (def.category === 'tile') return `${size} · $${def.baseCost} per tile`;
    if (def.landmark) return `${size} · landmark · +1 perk`;
    if (def.festivals) return `${size} · festivals & projects`;
    if (def.happiness) return `${size} · +${def.happiness.amount} mood · ${def.happiness.radius} tiles`;
    const jobs = def.jobs?.(1) ?? 0;
    const pay = def.incomePerWorker?.(1) ?? 0;
    const jobText = `${jobs} job${jobs === 1 ? '' : 's'}`;
    const boost = def.standBoostPerWorker?.(1);
    if (boost) return `${size} · ${jobText} · stands +${Math.round(boost * 100)}% each`;
    // Kept short (no size) so the line fits beside the price button.
    if (def.offlineHoursPerWorker) return `${jobText} · +${def.offlineHoursPerWorker(1)}h cap each`;
    if (def.moodPerWorker) return `${jobText} · +${def.moodPerWorker.amount(1)} mood each`;
    if (def.hookPerWorker) return `${jobText} · +${def.hookPerWorker} fish each`;
    if (def.sonarPerWorker) return `${jobText} · +${def.sonarPerWorker(1)}m sonar each`;
    if (def.dockPricePerWorker) return `${jobText} · +${Math.round(def.dockPricePerWorker(1) * 100)}% dock price each`;
    if (def.millPerWorker) return `${jobText} · +${def.millPerWorker.amount * 100}% nearby each`;
    if (def.id === 'boatyard') return `${jobText} · builds boats`;
    if (def.crateCapacity) return `${size} · +${def.crateCapacity(1)} fish storage`;
    if (def.cansPerWorker) return `${jobText} · ${def.cansPerWorker(1)} cans/min each`;
    if (def.fleet) return `${jobText} · fishing boats`;
    if (def.shipCansPerWorker) return `${jobText} · ships take ${def.shipCansPerWorker(1)} cans each`;
    if (def.speciesIncomePerWorker) return `${jobText} · $${fmtRate(def.speciesIncomePerWorker(1))}/min per species`;
    return pay > 0 ? `${size} · ${jobText} · $${fmtRate(pay)}/min each` : `${size} · ${jobText}`;
  }

  private openBuildingPanel(b: PlacedBuilding): void {
    if (b.type === 'playerHouse') {
      this.openHousePanel(b);
      return;
    }
    this.closeModal();
    this.panelFor = b;
    const def = defOf(b);
    const sells = UPGRADES.filter((u) => u.shop === def.id);
    const isHome = !!def.housing;
    const isWork = !!def.jobs;
    const isDecor = !!def.happiness;
    const upgradable = def.maxLevel > 1;
    const height =
      104 +
      (isHome ? 144 : 0) +
      (isWork ? 156 : 0) +
      (isDecor ? 70 : 0) +
      (upgradable ? 70 : 0) +
      sells.length * 66 +
      (def.id === 'baitShop' || def.id === 'tackleShop' || def.id === 'boatyard' || def.id === 'aquarium' || def.id === 'icehouse' || def.dockPricePerWorker ? 66 : 0) +
      (def.festivals ? 132 : 0) +
      (upgradeNeed(b) ? 22 : 0) +
      130;
    const m = (this.modal = new Modal(this, height));
    const reopen = () => this.openBuildingPanel(b);
    const right = GAME_WIDTH - 90;
    const moods = happinessByResident();

    m.text(GAME_WIDTH / 2, m.top + 32, upgradable ? `${def.name}  ·  Lv ${b.level}` : def.name, 24);
    m.text(GAME_WIDTH / 2, m.top + 64, def.description, 14)
      .setAlpha(0.8)
      .setAlign('center')
      .setWordWrapWidth(GAME_WIDTH - 90);
    let y = m.top + 108;

    if (isHome) {
      const residents = residentsOf(b);
      m.text(40, y, `Residents ${residents.length}/${housingOf(b)}`, 18, 0);
      const names = residents.length > 0 ? residents.map((r) => r.name).join(', ') : 'Waiting for someone to move in…';
      m.text(40, y + 26, names, 14, 0).setAlpha(0.75).setWordWrapWidth(GAME_WIDTH - 90);
      y += 70;

      // Mood: average of residents, with what makes up the home's part of it.
      const mood = homeMood(b);
      const avg = averageHappiness(residents, moods);
      const shown = avg ?? Math.min(100, mood.total + 10);
      const color = shown >= 65 ? '#8ee88e' : shown < 35 ? '#ff8a8a' : COLORS.gold;
      m.text(40, y, `Happiness ${Math.round(shown)}%${avg === null ? ' (expected)' : ''}`, 18, 0).setColor(color);
      // Only what actually adds something, so the line fits.
      const parts = [`base ${mood.base}`];
      if (mood.decor > 0) parts.push(`decor +${mood.decor}`);
      if (mood.road > 0) parts.push(`road +${mood.road}`);
      if (mood.water > 0) parts.push(`water +${mood.water}`);
      if (mood.tavern > 0) parts.push(`tavern +${mood.tavern}`);
      if (mood.town > 0) parts.push(`town +${mood.town}`);
      parts.push('job ±10');
      m.text(40, y + 26, parts.join(' · '), 14, 0).setAlpha(0.75);
      y += 74;
    }

    if (isDecor) {
      const effect = def.happiness!;
      m.text(40, y, `+${effect.amount} happiness for homes within ${effect.radius} tiles`, 16, 0).setColor(COLORS.gold);
      const homes = state.buildings.filter((h) => defOf(h).housing && decorBonus(b, h) > 0).length;
      m.text(40, y + 26, homes === 1 ? 'Cheering up 1 home' : `Cheering up ${homes} homes`, 14, 0).setAlpha(0.75);
      y += 70;
    }

    if (isWork) {
      const workers = workersOf(b);
      const slots = jobSlots(b);
      const target = staffTarget(b);
      m.text(40, y, `Workers ${workers.length}/${slots}`, 18, 0);
      const wage = wagePerWorker(b);
      if (wage > 0) m.text(40, y + 20, `wages $${fmtRate(wage)}/min each`, 12, 0).setAlpha(0.6);
      const star = makeButton(this, right, y, 120, 38, b.priority ? '* Priority' : 'Priority', () => {
        togglePriority(b);
        reopen();
      }, b.priority ? COLORS.primary : COLORS.neutral, 16);
      m.add(star);

      // Staffing: how many of the slots the player wants filled.
      const sy = y + 46;
      m.text(40, sy, 'Staff', 16, 0).setAlpha(0.8);
      const minus = makeButton(this, 120, sy, 44, 38, '−', () => {
        setStaff(b, target - 1);
        reopen();
      }, COLORS.neutral, 22);
      minus.setEnabledLook(target > 0, COLORS.neutral);
      m.text(162, sy, `${target}`, 20);
      const plus = makeButton(this, 204, sy, 44, 38, '+', () => {
        setStaff(b, target + 1);
        reopen();
      }, COLORS.neutral, 22);
      plus.setEnabledLook(target < slots, COLORS.neutral);
      m.add(minus, plus);

      const perWorker = incomePerWorkerOf(b);
      let status: string;
      let color: string = COLORS.gold;
      if (workers.length > 0) {
        const mood = averageHappiness(workers, moods) ?? 50;
        const extras = [`mood ×${incomeMultiplier(mood).toFixed(2)}`];
        if (touchesRoad(b)) extras.push('road +10%');
        const fillets = filletBoost();
        if (def.id === 'fishStand' && fillets > 0) extras.push(`fillets +${Math.round(fillets * 100)}%`);
        const mill = millBoost(b);
        if (mill > 0) extras.push(`mill +${Math.round(mill * 100)}%`);
        const orders = deliveryBoost(b);
        if (orders > 0) extras.push(`orders +${Math.round(orders * 100)}%`);
        const boost = def.standBoostPerWorker?.(b.level);
        const service = this.serviceStatus(b, workers.length);
        if (!isWorking(b)) {
          color = '#8ecae6';
          status = 'No water! Dig a canal right beside it.';
        } else if (boost) status = `Fish Stands earn +${Math.round(boost * workers.length * (1 + mill) * 100)}%`;
        else if (perWorker > 0) status = `Earning $${fmtRate(workplaceIncome(b, moods))}/min (${extras.join(', ')})`;
        else status = service ?? 'Open for business';
      } else {
        color = '#ff8a8a';
        const closed = sells.length > 0 ? 'Closed: needs a shopkeeper. ' : 'No workers. ';
        status = closed + (target === 0 ? 'Raise staff to hire.' : unemployedCount() === 0 ? 'Build homes for more residents.' : '');
      }
      m.text(40, y + 88, status, 15, 0).setColor(color).setWordWrapWidth(GAME_WIDTH - 90);
      if (workers.length > 0) {
        m.text(40, y + 116, workers.map((r) => r.name).join(', '), 14, 0).setAlpha(0.75).setWordWrapWidth(GAME_WIDTH - 90);
      }
      y += 156;
    }

    // Level upgrade
    if (upgradable) {
      const maxed = b.level >= def.maxLevel;
      // Buildings can't outgrow the town: the next level waits for a house upgrade.
      const waiting = !maxed && b.level >= levelCap(b);
      const cost = def.upgradeCost(b.level);
      m.text(40, y - 10, maxed ? 'Fully upgraded' : `Upgrade to Lv ${b.level + 1}`, 18, 0);
      const need = maxed ? undefined : upgradeNeed(b);
      const fishOk = !need || onIce(need.fish) >= need.amount;
      // Room the gain text takes beyond one line, when it wraps beside the button.
      let extra = 0;
      if (!maxed) {
        const gain = waiting
          ? m.text(40, y + 4, `Needs your house at Lv ${b.level + 1}`, 14, 0).setColor('#ffb4a2')
          : m.text(40, y + 4, this.upgradeGain(b), 14, 0).setAlpha(0.75);
        gain.setOrigin(0, 0).setWordWrapWidth(right - 55 - 48);
        extra = Math.max(0, gain.height - 22);
        if (need) {
          m.text(40, y + 36 + extra, `${fishOk ? '[x]' : '[ ]'} ${need.amount} ${fishName(need.fish)} on ice (have ${onIce(need.fish)})`, 13, 0)
            .setColor(fishOk ? '#8ee88e' : '#ff8a8a');
        }
        const label = waiting ? `House ${b.level + 1}` : `$${formatCoins(cost)}`;
        const btn = makeButton(this, right, y, 110, 46, label, () => {
          if (upgradeBuilding(b)) {
            sfx.place();
            reopen();
          }
        }, COLORS.buy, waiting ? 16 : 18);
        btn.setEnabledLook(!waiting && fishOk && canAfford(cost), COLORS.buy);
        m.add(btn);
      }
      y += (need ? 92 : 70) + extra;
    }

    // Fishing gear sold here
    const open = sells.length > 0 && sellsNow(def.id);
    for (const up of sells) {
      const level = state.upgrades[up.id];
      const cap = upgradeLevelCap(up);
      const upCost = upgradeCost(up, level);
      m.text(40, y - 12, up.name, 18, 0);
      const desc = level >= up.maxLevel ? `${up.describe(level)} (max)` : `${up.describe(level)} > ${up.describe(level + 1)}`;
      m.text(40, y + 14, desc, 14, 0).setAlpha(0.75);
      if (level < up.maxLevel) {
        const locked = level >= cap;
        const label = !open ? 'Closed' : locked ? `Shop Lv${b.level + 1}` : `$${formatCoins(upCost)}`;
        const btn = makeButton(this, right, y, 110, 46, label, () => {
          if (buyUpgrade(up)) reopen();
        }, COLORS.buy, open && !locked ? 18 : 15);
        btn.setEnabledLook(open && !locked && canAfford(upCost), COLORS.buy);
        m.add(btn);
      }
      y += 66;
    }

    if (def.id === 'baitShop') {
      const owned = BAITS.reduce((sum, bt) => sum + (state.bait[bt.id] ?? 0), 0);
      m.text(40, y - 12, 'Bait', 18, 0);
      m.text(40, y + 14, owned > 0 ? `You have ${owned} bait` : 'Lures better fish', 14, 0).setAlpha(0.75);
      m.add(makeButton(this, right, y, 110, 46, 'Shop ›', () => this.openBaitStore(b), COLORS.primary, 18));
      y += 66;
    }

    if (def.festivals) {
      const on = festivalActive();
      const cost = festivalCost();
      m.text(40, y - 12, on ? `${state.festival!.name}!` : 'Festival', 18, 0).setColor(on ? COLORS.gold : '#ffffff');
      const what = `+${FESTIVAL.income * 100}% income, +${FESTIVAL.happiness} mood, fish +${FESTIVAL.fishPrice * 100}%`;
      m.text(40, y + 14, on ? `${festivalMinutesLeft()} min left · ${what}` : `${FESTIVAL.minutes(b.level)} min of ${what}`, 12, 0)
        .setAlpha(0.8)
        .setWordWrapWidth(GAME_WIDTH - 190);
      if (!on) {
        const host = makeButton(this, right, y, 110, 46, `$${formatCoins(cost)}`, () => {
          if (hostFestival(b.level)) {
            sfx.fanfare();
            showToast(this, `${state.festival!.name} has begun!`);
            this.refreshBuildingViews();
            reopen();
          }
        }, COLORS.buy, 18);
        host.setEnabledLook(canAfford(cost), COLORS.buy);
        m.add(host);
      }
      y += 66;
      m.text(40, y - 12, 'Town projects', 18, 0);
      const done = PROJECTS.filter((p) => projectFunded(p) >= p.cost).length;
      m.text(40, y + 14, `${done}/${PROJECTS.length} built · big lasting upgrades`, 13, 0).setAlpha(0.75);
      m.add(makeButton(this, right, y, 110, 46, 'Board ›', () => this.openProjects(b), COLORS.primary, 18));
      y += 66;
    }

    if (def.id === 'icehouse' || def.dockPricePerWorker) {
      m.text(40, y - 12, `Barrels ${cratesUsed()}/${crateCapacity()}`, 18, 0);
      m.text(40, y + 14, `Worth $${formatCoins(stockValue())} today`, 14, 0).setAlpha(0.75);
      m.add(
        makeButton(this, right, y, 110, 46, 'Sell >', () => {
          this.closeModal();
          openMarket(this, (mm) => (this.modal = mm), 0, () => this.openBuildingPanel(b));
        }, COLORS.primary, 18),
      );
      y += 66;
    }

    if (def.id === 'aquarium') {
      m.text(40, y - 12, 'Logbook', 18, 0);
      m.text(40, y + 14, `${speciesCount()} species on show`, 14, 0).setAlpha(0.75);
      m.add(
        makeButton(this, right, y, 110, 46, 'Open ›', () => {
          this.closeModal();
          openLogbook(this, (lm) => (this.modal = lm), 0, () => this.openBuildingPanel(b));
        }, COLORS.primary, 18),
      );
      y += 66;
    }

    if (def.id === 'tackleShop') {
      const owned = state.rods.length - 1;
      m.text(40, y - 12, 'Rods', 18, 0);
      m.text(40, y + 14, owned > 0 ? `${owned}/${RODS.length - 1} special rods` : 'Harpoon, Magnet, Wide Net', 14, 0).setAlpha(0.75);
      m.add(makeButton(this, right, y, 110, 46, 'Rods >', () => this.openRodShop(b), COLORS.primary, 18));
      y += 66;
    }

    if (def.id === 'boatyard') {
      const boats = AREAS.filter((a) => a.boat);
      const owned = boats.filter(ownsArea).length;
      m.text(40, y - 12, 'Boats', 18, 0);
      m.text(40, y + 14, `${owned}/${boats.length} built · new fishing spots`, 14, 0).setAlpha(0.75);
      m.add(makeButton(this, right, y, 110, 46, 'Boats ›', () => this.openBoatStore(b), COLORS.primary, 18));
      y += 66;
    }

    const actionsY = m.top + m.height - 92;
    m.add(
      makeButton(this, GAME_WIDTH * 0.3, actionsY, 160, 44, 'Move', () => {
        this.closeModal();
        this.enterBuildMode(def, b);
      }, COLORS.primary, 20),
      makeButton(this, GAME_WIDTH * 0.7, actionsY, 160, 44, `Sell $${formatCoins(sellValue(b))}`, () => this.confirmSell(b), COLORS.danger, 20),
      makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral),
    );
  }

  /** Bait for sale at the Bait Shop, one row per tier. */
  private openBaitStore(shop: PlacedBuilding): void {
    this.closeModal();
    this.panelFor = undefined;
    const rowH = 84;
    const m = (this.modal = new Modal(this, 170 + BAITS.length * rowH));
    const open = sellsNow('baitShop');
    m.text(GAME_WIDTH / 2, m.top + 30, 'Bait', 26);
    m.text(GAME_WIDTH / 2, m.top + 62, 'One bait is used per cast. Pick it on the dock.', 14).setAlpha(0.8);

    let y = m.top + 116;
    for (const bait of BAITS) {
      const unlocked = baitUnlocked(bait);
      const owned = state.bait[bait.id] ?? 0;
      m.add(this.add.circle(48, y, 13, bait.color).setStrokeStyle(2, 0x000000, 0.3).setAlpha(unlocked ? 1 : 0.35));
      m.text(74, y - 24, `${bait.name} ×${bait.packSize}`, 18, 0);
      m.text(74, y, bait.lures, 13, 0).setColor(COLORS.gold);
      m.text(74, y + 20, unlocked ? `Owned ${owned}` : `Unlocks at house level ${bait.unlockLevel}`, 12, 0).setColor(
        unlocked ? '#ffffff' : '#ffb4a2',
      ).setAlpha(unlocked ? 0.65 : 1);
      const label = !unlocked ? `Lv ${bait.unlockLevel}` : !open ? 'Closed' : `$${formatCoins(bait.packCost)}`;
      const btn = makeButton(this, GAME_WIDTH - 80, y, 100, 46, label, () => {
        if (buyBait(bait)) this.openBaitStore(shop);
      }, COLORS.buy, 18);
      btn.setEnabledLook(unlocked && open && canAfford(bait.packCost), COLORS.buy);
      m.add(btn);
      y += rowH;
    }
    if (!open) m.text(GAME_WIDTH / 2, y - 16, 'Closed: the Bait Shop needs a shopkeeper.', 14).setColor('#ff8a8a');
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Back', () => this.openBuildingPanel(shop), COLORS.neutral));
  }

  /** Special rods for sale at the Tackle Shop; switch between them on the dock. */
  private openRodShop(shop: PlacedBuilding): void {
    this.closeModal();
    this.panelFor = undefined;
    const rods = RODS.filter((r) => r.cost > 0);
    const rowH = 96;
    const m = (this.modal = new Modal(this, 170 + rods.length * rowH));
    const open = sellsNow('tackleShop');
    m.text(GAME_WIDTH / 2, m.top + 30, 'Rods', 26);
    m.text(GAME_WIDTH / 2, m.top + 62, 'Pick your rod on the dock', 16).setAlpha(0.8);
    let y = m.top + 124;
    for (const rod of rods) {
      const owned = ownsRod(rod);
      const unlocked = rodUnlocked(rod);
      m.text(40, y - 30, rod.name, 18, 0);
      m.text(40, y - 14, rod.blurb, 16, 0).setOrigin(0, 0).setColor(COLORS.gold).setWordWrapWidth(GAME_WIDTH - 190);
      if (!unlocked) m.text(40, y + 30, `Unlocks at house level ${rod.unlockLevel}`, 16, 0).setColor('#ffb4a2');
      const label = owned ? 'Owned' : !unlocked ? `Lv ${rod.unlockLevel}` : !open ? 'Closed' : `$${formatCoins(rod.cost)}`;
      const btn = makeButton(this, GAME_WIDTH - 84, y - 8, 100, 46, label, () => {
        if (buyRod(rod)) {
          sfx.coins();
          showToast(this, `${rod.name} bought! It's on the dock`);
          this.openRodShop(shop);
        }
      }, COLORS.buy, 18);
      btn.setEnabledLook(!owned && unlocked && open && canAfford(rod.cost), COLORS.buy);
      m.add(btn);
      y += rowH;
    }
    if (!open) m.text(GAME_WIDTH / 2, y - 16, 'Closed: the Tackle Shop needs a shopkeeper.', 16).setColor('#ff8a8a');
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Back', () => this.openBuildingPanel(shop), COLORS.neutral));
  }

  /** Boats for sale at the Boatyard; each one opens a new fishing area. */
  private openBoatStore(yard: PlacedBuilding): void {
    this.closeModal();
    this.panelFor = undefined;
    const boats = AREAS.filter((a) => a.boat);
    const rowH = 96;
    const m = (this.modal = new Modal(this, 170 + boats.length * rowH));
    const open = boatyardOpen();
    m.text(GAME_WIDTH / 2, m.top + 30, 'Boats', 26);
    m.text(GAME_WIDTH / 2, m.top + 62, 'Bought boats wait at the dock. Tap one to sail.', 14).setAlpha(0.8);

    let y = m.top + 124;
    for (const area of boats) {
      const owned = ownsArea(area);
      const unlocked = boatUnlocked(area);
      m.add(this.add.rectangle(48, y - 30, 26, 14, area.hull ?? 0xffffff).setStrokeStyle(2, area.cabin ?? 0x000000).setAlpha(unlocked ? 1 : 0.35));
      m.text(74, y - 30, `${area.boat}`, 18, 0);
      m.text(74, y - 18, `${area.name}: ${area.blurb}`, 13, 0)
        .setOrigin(0, 0)
        .setColor(COLORS.gold)
        .setWordWrapWidth(GAME_WIDTH - 214);
      if (!unlocked) m.text(74, y + 32, `Unlocks at house level ${area.unlockLevel}`, 12, 0).setColor('#ffb4a2');
      const label = owned ? 'Owned' : !unlocked ? `Lv ${area.unlockLevel}` : !open ? 'Closed' : `$${formatCoins(area.cost)}`;
      const btn = makeButton(this, GAME_WIDTH - 84, y - 8, 100, 46, label, () => {
        if (buyBoat(area)) this.openBoatStore(yard);
      }, COLORS.buy, 18);
      btn.setEnabledLook(!owned && unlocked && open && canAfford(area.cost), COLORS.buy);
      m.add(btn);
      y += rowH;
    }
    if (!open) m.text(GAME_WIDTH / 2, y - 16, 'Closed: the Boatyard needs a worker and water.', 14).setColor('#ff8a8a');
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Back', () => this.openBuildingPanel(yard), COLORS.neutral));
  }

  /** Your house: the town level, what the next level needs, and what it unlocks. */
  private openHousePanel(b: PlacedBuilding): void {
    this.closeModal();
    this.panelFor = b;
    const def = defOf(b);
    const level = b.level;
    const next = TOWN_LEVELS[level + 1];
    const unlocks = next ? unlocksAt(level + 1) : [];
    const height = next ? (next.fish ? 450 : 424) : 320;
    const m = (this.modal = new Modal(this, height));
    const reopen = () => this.openHousePanel(b);

    m.text(GAME_WIDTH / 2, m.top + 32, `Your House  ·  Lv ${level}`, 24);
    m.text(GAME_WIDTH / 2, m.top + 64, def.description, 14).setAlpha(0.8).setAlign('center').setWordWrapWidth(GAME_WIDTH - 90);
    const bonus = Math.round(FISH_PRICE_BONUS_PER_LEVEL * (level - 1) * 100);
    m.text(40, m.top + 104, `Town level ${level} of ${MAX_TOWN_LEVEL}`, 18, 0);
    m.text(40, m.top + 130, bonus > 0 ? `Fish sell for +${bonus}%` : 'Each level makes fish sell for +10%', 14, 0)
      .setColor(COLORS.gold);

    if (next) {
      let y = m.top + 176;
      m.text(40, y, `Upgrade to Lv ${level + 1}`, 18, 0);
      y += 30;
      const residentsOk = state.residents.length >= next.residents;
      m.text(40, y, `${residentsOk ? '[x]' : '[ ]'} ${state.residents.length}/${next.residents} residents`, 15, 0).setColor(
        residentsOk ? '#8ee88e' : '#ff8a8a',
      );
      y += 26;
      if (next.fish) {
        const have = onIce(next.fish.fish);
        const ok = have >= next.fish.amount;
        m.text(40, y, `${ok ? '[x]' : '[ ]'} ${next.fish.amount} ${fishName(next.fish.fish)} on ice (have ${have})`, 15, 0).setColor(
          ok ? '#8ee88e' : '#ff8a8a',
        );
        y += 26;
      }
      const perks = unlocks.map((d) => d.name);
      for (const d of BUILDINGS) {
        if (!d.countAtLevel) continue;
        const more = Math.min(d.maxCount, d.countAtLevel(level + 1)) - Math.min(d.maxCount, d.countAtLevel(level));
        if (more > 0) perks.push(`+${more} ${d.name}${more === 1 ? '' : 's'}`);
      }
      perks.push(`building upgrades to Lv ${level + 1}`);
      if (level + 1 === QUESTS.unlockLevel) perks.unshift('Quests');
      if (level + 1 === ORDERS.unlockLevel) perks.unshift('Orders');
      m.text(40, y, `Unlocks: ${perks.join(', ')}`, 14, 0).setOrigin(0, 0).setAlpha(0.85).setWordWrapWidth(GAME_WIDTH - 90);

      const ready = houseUpgradeBlockers().length === 0;
      const btn = makeButton(this, GAME_WIDTH - 90, m.top + 186, 110, 46, `$${formatCoins(next.cost)}`, () => {
        if (upgradeBuilding(b)) {
          this.refreshBuildingViews();
          this.floatText(b, `Town level ${b.level}!`, 20, COLORS.gold);
          sfx.fanfare();
          reopen();
        }
      }, COLORS.buy, 18);
      btn.setEnabledLook(ready && canAfford(next.cost), COLORS.buy);
      m.add(btn);
    } else {
      m.text(GAME_WIDTH / 2, m.top + 176, 'Fully upgraded!', 18).setColor('#8ee88e');
    }

    const free = pointsFree();
    m.add(
      makeButton(this, GAME_WIDTH * 0.3, m.top + m.height - 92, 160, 44, 'Move', () => {
        this.closeModal();
        this.enterBuildMode(def, b);
      }, COLORS.primary, 20),
      makeButton(this, GAME_WIDTH * 0.7, m.top + m.height - 92, 160, 44, free > 0 ? `Perks (${free})` : 'Perks', () => this.openPerks(), COLORS.buy, 20),
      makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral),
    );
  }

  /** The perk tree: one branch at a time, deeper perks open as you spend points in it. */
  private openPerks(branch: PerkBranch = 'fishing'): void {
    this.closeModal();
    const perks = PERKS.filter((p) => p.branch === branch);
    const rowH = 70;
    const m = (this.modal = new Modal(this, 300 + perks.length * rowH));
    const free = pointsFree();
    m.text(GAME_WIDTH / 2, m.top + 30, 'Perks', 26);
    m.text(GAME_WIDTH / 2, m.top + 60, `${free} point${free === 1 ? '' : 's'} to spend · ${pointsEarned()} earned`, 15).setColor(
      free > 0 ? COLORS.gold : '#ffffff',
    );
    const branches: [PerkBranch, string][] = [['fishing', 'Fishing'], ['town', 'Town'], ['trade', 'Trade']];
    branches.forEach(([id, label], i) => {
      const btn = makeButton(this, GAME_WIDTH / 2 + (i - 1) * 124, m.top + 100, 116, 40, `${label} ${branchSpent(id)}`, () => this.openPerks(id), COLORS.primary, 16);
      btn.setEnabledLook(id === branch, COLORS.primary);
      m.add(btn);
    });

    let y = m.top + 160;
    for (const p of perks) {
      const rank = perkRank(p.id);
      const open = perkOpen(p);
      m.text(40, y - 16, `${p.name}  ${rank}/${p.maxRank}`, 17, 0).setAlpha(open ? 1 : 0.5);
      const now = rank > 0 ? p.describe(rank) : 'Not learned yet';
      const next = rank < p.maxRank ? ` > ${p.describe(rank + 1)}` : '';
      const info = open ? `${rank > 0 ? now : ''}${rank > 0 ? next : p.describe(1)}` : `Needs ${PERK_TIER_POINTS[p.tier]} points in this branch`;
      m.text(40, y + 8, info, 13, 0)
        .setColor(open ? COLORS.gold : '#ffb4a2')
        .setWordWrapWidth(GAME_WIDTH - 180);
      if (rank < p.maxRank) {
        const btn = makeButton(this, GAME_WIDTH - 76, y, 84, 40, '+1', () => {
          if (buyPerk(p)) this.openPerks(branch);
        }, COLORS.buy, 18);
        btn.setEnabledLook(canBuyPerk(p), COLORS.buy);
        m.add(btn);
      } else {
        m.text(GAME_WIDTH - 76, y, 'Max', 16).setColor('#8ee88e');
      }
      y += rowH;
    }

    const sources = pointSources()
      .map((src) => `${src.label} ${src.points}/${src.max}`)
      .join(' · ');
    m.text(GAME_WIDTH / 2, y + 4, `Points from: ${sources}`, 12).setAlpha(0.65).setAlign('center').setWordWrapWidth(GAME_WIDTH - 80);
    const reset = makeButton(this, GAME_WIDTH * 0.3, m.top + m.height - 34, 150, 44, 'Reset perks', () => {
      resetPerks();
      this.openPerks(branch);
    }, COLORS.danger, 17);
    reset.setEnabledLook(pointsEarned() - free > 0, COLORS.danger);
    m.add(reset, makeButton(this, GAME_WIDTH * 0.7, m.top + m.height - 34, 150, 44, 'Close', () => this.closeModal(), COLORS.neutral));
  }

  /** What a staffed service building is doing for the town right now, or undefined. */
  private serviceStatus(b: PlacedBuilding, workers: number): string | undefined {
    const def = defOf(b);
    if (def.offlineHoursPerWorker) return `Offline earnings cap: ${offlineCapHours()}h (+${def.offlineHoursPerWorker(b.level) * workers}h here)`;
    if (def.moodPerWorker) {
      const homes = state.buildings.filter((h) => defOf(h).housing && tileGap(b, h) <= def.moodPerWorker!.radius).length;
      return `+${def.moodPerWorker.amount(b.level) * workers} mood for ${homes} home${homes === 1 ? '' : 's'} within ${def.moodPerWorker.radius} tiles`;
    }
    if (def.hookPerWorker) return `Your hook carries +${hookBonus()} fish`;
    if (def.sonarPerWorker) return `Sonar range: ${sonarRange()} m`;
    if (def.dockPricePerWorker) return `Your catch sells for +${Math.round(marketBonus() * 100)}% at the dock`;
    if (def.millPerWorker) {
      const nearby = state.buildings.filter((x) => x !== b && earns(defOf(x)) && tileGap(b, x) <= def.millPerWorker!.radius).length;
      return `+${Math.round(def.millPerWorker.amount * workers * 100)}% for ${nearby} workplace${nearby === 1 ? '' : 's'} within ${def.millPerWorker.radius} tiles`;
    }
    if (def.cansPerWorker) {
      if (holdCapacity() === 0) return `${state.cans} cans · needs a Fishing Wharf to bring in fish`;
      return `${state.cans}/${TRADE.maxCans} cans ($${formatCoins(state.cansValue)}) · ${fmtRate(canningRate())}/min · ${holdCount()} fish waiting at the wharf`;
    }
    if (def.fleet) {
      const f = fleet();
      const hold = `hold ${holdCount()}/${holdCapacity()}`;
      if (!f) return `Needs ${FLEET.crewPerBoat} fishermen per boat · ${hold}`;
      return `${f.boats} boat${f.boats === 1 ? '' : 's'} fishing · ${def.fleet.haul(b.level)} fish a trip · ${hold}`;
    }
    if (def.shipCansPerWorker) {
      const t = Math.ceil(secondsToShip());
      return `Next ship in ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}, takes up to ${shipCapacity()} cans (${state.cans} ready)`;
    }
    if (def.id === 'boatyard') {
      const next = AREAS.find((a) => a.boat && !ownsArea(a));
      return next ? `Ready to build a ${next.boat} for the ${next.name}` : 'Every boat is built!';
    }
    return undefined;
  }

  /** What the next level brings, e.g. "+1 job slot" or "+1 resident". */
  private upgradeGain(b: PlacedBuilding): string {
    const def = defOf(b);
    const gains: string[] = [];
    if (def.housing) {
      const more = def.housing(b.level + 1) - def.housing(b.level);
      if (more > 0) gains.push(`+${more} resident${more === 1 ? '' : 's'}`);
    }
    if (def.jobs) {
      const more = def.jobs(b.level + 1) - def.jobs(b.level);
      if (more > 0) gains.push(`+${more} job slot${more === 1 ? '' : 's'}`);
    }
    if (def.incomePerWorker) {
      const now = def.incomePerWorker(b.level);
      const next = def.incomePerWorker(b.level + 1);
      if (now > 0 && next > now) gains.push(`$${fmtRate(next)}/min each`);
    }
    if (def.speciesIncomePerWorker) {
      gains.push(`$${fmtRate(def.speciesIncomePerWorker(b.level + 1))} per species`);
    }
    if (def.standBoostPerWorker) {
      const pct = (l: number) => Math.round(def.standBoostPerWorker!(l) * 1000) / 10;
      gains.push(`+${pct(b.level + 1)}% per worker (was ${pct(b.level)}%)`);
    }
    const next = b.level + 1;
    if (def.offlineHoursPerWorker) gains.push(`+${def.offlineHoursPerWorker(next)}h per worker (was ${def.offlineHoursPerWorker(b.level)}h)`);
    if (def.moodPerWorker) gains.push(`+${def.moodPerWorker.amount(next)} mood per worker (was ${def.moodPerWorker.amount(b.level)})`);
    if (def.sonarPerWorker) gains.push(`+${def.sonarPerWorker(next)} m per worker (was ${def.sonarPerWorker(b.level)} m)`);
    if (def.dockPricePerWorker) {
      const pct = (l: number) => Math.round(def.dockPricePerWorker!(l) * 100);
      gains.push(`+${pct(next)}% dock price per worker (was ${pct(b.level)}%)`);
    }
    if (UPGRADES.some((u) => u.shop === def.id)) gains.push('better gear');
    return gains.join(', ');
  }

  private confirmSell(b: PlacedBuilding): void {
    this.closeModal();
    const def = defOf(b);
    const sellsGear = UPGRADES.some((u) => u.shop === def.id);
    const homeless = residentsOf(b).length;
    const value = sellValue(b);
    const notes: string[] = [];
    if (sellsGear) notes.push('Gear you already bought is kept.');
    if (homeless > 0) notes.push('Residents move to free homes, or leave town.');
    const m = (this.modal = new Modal(this, 220 + notes.length * 30));

    m.text(GAME_WIDTH / 2, m.top + 36, `Sell ${def.name}?`, 26);
    m.text(GAME_WIDTH / 2, m.top + 80, `You get $${formatCoins(value)} back.`, 18).setColor(COLORS.gold);
    notes.forEach((n, i) => m.text(GAME_WIDTH / 2, m.top + 112 + i * 28, n, 15).setAlpha(0.8));
    const buttonsY = m.top + m.height - 44;
    // Keep sits where the panel's Sell button was, so a double tap doesn't sell by accident.
    m.add(
      makeButton(this, GAME_WIDTH * 0.7, buttonsY, 150, 48, 'Keep', () => this.openBuildingPanel(b), COLORS.neutral),
      makeButton(this, GAME_WIDTH * 0.3, buttonsY, 150, 48, 'Sell', () => {
        this.closeModal();
        this.floatText(b, `+$${formatCoins(value)}`, 22, COLORS.gold);
        sellBuilding(b);
        this.refreshBuildingViews();
      }, COLORS.danger),
    );
  }
}
