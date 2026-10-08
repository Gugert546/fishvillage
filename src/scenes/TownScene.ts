import Phaser from 'phaser';
import {
  AREAS,
  BAITS,
  FISH,
  PERKS,
  PERK_TIER_POINTS,
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
  shopOpen,
  staffTarget,
  unemployedCount,
  workerCounts,
  workersOf,
} from '../population';
import { state, type PlacedBuilding, type Resident } from '../state';
import { makeTextures } from '../textures';
import { Villagers, makePerson, makePlayer } from './Villagers';
import { isWorking, touchesWater, wateredTiles } from '../water';
import { speciesCount } from '../logbook';
import { branchSpent, buyPerk, canBuyPerk, perkOpen, perkRank, pointSources, pointsEarned, pointsFree, resetPerks } from '../perks';
import { canningRate, secondsToShip, shipCapacity, takeShipVisits } from '../trade';
import { ATMOSPHERE_DEPTH, Atmosphere } from '../atmosphere';
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
  sellCrates,
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
  openLogbook,
  openSettings,
  showOfflineEarnings,
  showToast,
  type Button,
} from '../ui';

// World layout: grid rows grow upward from y = 0; the shore and dock sit below it.
const SHORE_H = 40;
const WORLD_BOTTOM = 360;
const DOCK = { x: GRID_X + 6 * TILE + 5, y: SHORE_H - 10, w: 50, h: 230 };
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
  private ground!: Phaser.GameObjects.Graphics;
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

  private tileGfx!: Phaser.GameObjects.Graphics;
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
  private nightLights?: Phaser.GameObjects.Graphics;
  private questBadgeText!: Phaser.GameObjects.Text;

  constructor() {
    super('Town');
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
    this.ground = this.add.graphics().setDepth(0);
    this.gridLines = this.add.graphics().setDepth(1);
    this.tileGfx = this.add.graphics().setDepth(2);
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
    this.refreshQuestButton();
    if (!this.modal) this.modal = showOfflineEarnings(this, () => (this.modal = undefined));

    if (!this.gesture && Math.abs(this.velocity) > 5) {
      this.scrollTo(this.cameras.main.scrollY - this.velocity * dt);
      this.velocity *= Math.exp(-dt * 4);
    }
    if (this.ghost) this.refreshGhost();
    if (this.paint) this.autoScrollPaint(dt);
    this.expandButton?.setEnabledLook(state.coins >= nextExpansionCost(), COLORS.buy);
  }

  // ------------------------------------------------------------- World

  /** A trade ship sails in past the pier, unloads its coins, and heads back out to sea. */
  private sailShip(coins: number): void {
    sfx.horn();
    const y = SHORE_H + 175;
    const g = this.add.graphics();
    g.fillStyle(0x264653).fillPoints(
      [new Phaser.Math.Vector2(-60, -6), new Phaser.Math.Vector2(60, -6), new Phaser.Math.Vector2(48, 14), new Phaser.Math.Vector2(-52, 14)],
      true,
    );
    g.fillStyle(0xe76f51).fillRect(-60, -6, 120, 4);
    const boxes = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x457b9d];
    boxes.forEach((c, i) => g.fillStyle(c).fillRect(-46 + i * 16, -20, 14, 14));
    g.fillStyle(0xf1faee).fillRect(30, -34, 22, 28);
    g.fillStyle(0x1d3557).fillRect(33, -30, 16, 6);
    g.fillStyle(0x333333).fillRect(38, -44, 6, 10);
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
    const g = this.ground.clear();

    // Forest beyond the town
    g.fillStyle(0x2d6a4f);
    g.fillRect(0, top, GAME_WIDTH, -top);
    g.fillStyle(0x1b4332);
    for (let y = top + 20; y < -rows * TILE; y += 46) {
      for (let x = (y / 46) % 2 === 0 ? 10 : 33; x < GAME_WIDTH; x += 46) g.fillCircle(x, y, 18);
    }

    // Next expansion strip
    if (canExpand()) {
      const stripTop = -(rows + ROWS_PER_EXPANSION) * TILE;
      g.fillStyle(0x52b788, 0.55);
      g.fillRect(GRID_X, stripTop, TOWN_COLS * TILE, ROWS_PER_EXPANSION * TILE);
    }

    // Unlocked land, checkered in 2×2 blocks so the fine grid stays calm
    g.fillStyle(0x74c69d);
    g.fillRect(0, -rows * TILE, GAME_WIDTH, rows * TILE);
    g.fillStyle(0x82cca5);
    for (let r = 0; r < rows; r += 2) {
      for (let c = 0; c < TOWN_COLS; c += 2) {
        if ((r / 2 + c / 2) % 2 === 0) g.fillRect(GRID_X + c * TILE, -(r + 2) * TILE, TILE * 2, TILE * 2);
      }
    }
    // Fence along the top edge
    g.fillStyle(0x8b5a2b);
    g.fillRect(GRID_X - 4, -rows * TILE - 4, TOWN_COLS * TILE + 8, 5);
    for (let x = GRID_X - 4; x <= GRID_X + TOWN_COLS * TILE; x += 30) g.fillRect(x, -rows * TILE - 12, 5, 14);

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
    g.lineStyle(1, 0x000000, 0.14);
    for (let c = 0; c <= TOWN_COLS; c++) g.lineBetween(GRID_X + c * TILE, 0, GRID_X + c * TILE, -rows * TILE);
    for (let r = 0; r <= rows; r++) g.lineBetween(GRID_X, -r * TILE, GRID_X + TOWN_COLS * TILE, -r * TILE);
  }

  private drawShoreAndDock(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x3fa7d6);
    g.fillRect(0, SHORE_H, GAME_WIDTH, WORLD_BOTTOM - SHORE_H);

    // Boardwalk along the waterfront: planks across, a heavy edge beam, posts in the water.
    g.fillStyle(0x1f6f99, 0.45);
    g.fillRect(0, SHORE_H, GAME_WIDTH, 10); // shadow on the water
    g.fillStyle(0x5c3a1e);
    for (let x = 12; x < GAME_WIDTH; x += 44) g.fillRect(x, SHORE_H - 2, 7, 16);
    for (let x = 0, i = 0; x < GAME_WIDTH; x += 15, i++) {
      g.fillStyle(i % 2 === 0 ? 0xa47148 : 0x9a6a42);
      g.fillRect(x, 0, 15, SHORE_H - 5);
      g.fillStyle(0x6b4423, 0.55);
      g.fillRect(x, 0, 1, SHORE_H - 5);
    }
    g.fillStyle(0x6b4423);
    g.fillRect(0, SHORE_H - 6, GAME_WIDTH, 6);
    g.fillStyle(0x4a2f1a, 0.35);
    g.fillRect(0, 0, GAME_WIDTH, 2); // where the grass meets the boards

    // Fishing pier
    g.fillStyle(0x5c3a1e);
    for (let y = DOCK.y + 40; y < DOCK.y + DOCK.h; y += 60) {
      g.fillRect(DOCK.x - 4, y, 8, 26);
      g.fillRect(DOCK.x + DOCK.w - 4, y, 8, 26);
    }
    g.fillStyle(0x8b5a2b);
    g.fillRect(DOCK.x, DOCK.y, DOCK.w, DOCK.h);
    g.fillStyle(0x6e4522);
    for (let y = DOCK.y; y < DOCK.y + DOCK.h; y += 18) g.fillRect(DOCK.x, y, DOCK.w, 2);

    const sign = makeText(this, DOCK.x + DOCK.w + 12, DOCK.y + 70, 'Go fishing ›', 18).setOrigin(0, 0.5);
    this.tweens.add({ targets: sign, x: sign.x + 6, duration: 600, yoyo: true, repeat: -1 });
  }

  // ---------------------------------------------------------- Buildings

  private drawBuilding(def: BuildingDef, status?: ViewStatus, placed?: PlacedBuilding): Phaser.GameObjects.Container {
    if (def.category === 'decor' || def.category === 'tile') return this.decorView(def, placed);
    if (def.id === 'lighthouse') return this.lighthouseView(def, status);
    const pw = def.w * TILE;
    const ph = def.h * TILE;
    const eave = ph * 0.42;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18);
    g.fillRect(8, 10, pw - 10, ph - 12);

    const chimney = this.chimneyOf(def);
    if (chimney) {
      g.fillStyle(0x6b4f3a);
      g.fillRect(chimney.x - 3.5, chimney.y, 7, 16);
    }
    g.fillStyle(def.wall);
    g.fillRect(6, eave - 4, pw - 12, ph - eave - 2);
    g.fillStyle(def.roof);
    g.fillTriangle(1, eave, pw / 2, 3, pw - 1, eave);

    const doorH = Math.min(22, ph * 0.3);
    if (def.id === 'apartment') {
      // Rows of lit windows
      g.fillStyle(0xffe8a3);
      for (let wy = eave + 8; wy < ph - doorH - 12; wy += 22) {
        for (let wx = 16; wx < pw - 24; wx += 24) g.fillRect(wx, wy, 14, 12);
      }
    } else if (def.id === 'playerHouse') {
      // Lit windows with shutters, and a pennant on the roof.
      for (const wx of [16, pw - 40]) {
        g.fillStyle(0x2a6f97);
        g.fillRect(wx - 4, eave + 12, 4, 22);
        g.fillRect(wx + 24, eave + 12, 4, 22);
        g.fillStyle(0xffe8a3);
        g.fillRect(wx, eave + 12, 24, 22);
        g.fillStyle(0xfaf3e0);
        g.fillRect(wx + 11, eave + 12, 2, 22);
      }
      g.fillStyle(0x5c3a1e);
      g.fillRect(pw / 2 - 1, -12, 2, 18);
      g.fillStyle(0xffd166);
      g.fillTriangle(pw / 2 + 1, -12, pw / 2 + 15, -7, pw / 2 + 1, -2);

    } else if (def.id === 'cannery') {
      // Factory: saw-tooth roofline, a tall chimney and a conveyor of cans.
      g.fillStyle(0x495057);
      g.fillRect(pw - 26, 0, 12, eave);
      g.fillStyle(0xdee2e6);
      for (let x = 16; x < pw - 36; x += 22) g.fillRect(x, eave + 10, 14, 12);
      g.fillStyle(0x343a40);
      g.fillRect(10, ph - 22, pw - 20, 5);
      g.fillStyle(0xced4da);
      for (let x = 14; x < pw - 14; x += 10) g.fillRect(x, ph - 30, 7, 8);
    } else if (def.id === 'exportDocks') {
      // Warehouse front with a crane and stacked shipping containers.
      g.fillStyle(0x6b4f3a);
      g.fillRect(14, ph - 34, 30, 28);
      const boxes = [0xe63946, 0x2a9d8f, 0xe9c46a, 0x457b9d];
      boxes.forEach((c, i) => {
        g.fillStyle(c);
        g.fillRect(52 + (i % 2) * 26, ph - 18 - Math.floor(i / 2) * 14, 24, 12);
      });
      g.lineStyle(3, 0xf4a261);
      g.lineBetween(pw - 18, ph - 6, pw - 18, eave - 20);
      g.lineBetween(pw - 18, eave - 20, pw - 60, eave - 20);
      g.lineStyle(1, 0x222222);
      g.lineBetween(pw - 56, eave - 20, pw - 56, eave + 10);
    } else if (def.id === 'icehouse') {
      // Thick insulated walls, a frosty door and ice blocks stacked outside.
      g.fillStyle(0x9ecae1);
      g.fillRect(pw / 2 - 8, ph - 24, 16, 18);
      g.fillStyle(0xffffff, 0.8);
      g.fillRect(pw / 2 - 6, ph - 22, 4, 6);
      g.fillStyle(0xd6f1fb);
      g.fillRect(6, ph - 14, 10, 8);
      g.fillRect(pw - 16, ph - 14, 10, 8);
      g.fillRect(pw - 14, ph - 21, 8, 7);
      g.fillStyle(0xffffff);
      g.fillRect(1, eave - 2, pw - 2, 3);
    } else if (def.id === 'aquarium') {
      // A big glass tank across the front, with a few fish inside.
      g.fillStyle(0x48cae4);
      g.fillRect(10, ph - 30, pw - 20, 22);
      g.fillStyle(0xffffff, 0.35);
      g.fillRect(12, ph - 28, pw - 24, 4);
      for (const [fx, fy, c] of [[24, ph - 18, 0xff7f2a], [52, ph - 22, 0xffd166], [80, ph - 15, 0x2a6fdb], [100, ph - 21, 0xff5d8f]]) {
        g.fillStyle(c);
        g.fillEllipse(fx, fy, 9, 5);
        g.fillTriangle(fx - 4, fy, fx - 8, fy - 3, fx - 8, fy + 3);
      }
      g.fillStyle(0x3d5a80);
      g.fillRect(pw / 2 - 3, eave - 2, 6, ph - eave - 30);
    } else if (def.id === 'warehouse') {
      // Wide barn doors and a stack of crates.
      g.fillStyle(0x6b4f3a);
      g.fillRect(pw / 2 - 18, ph - 30, 36, 24);
      g.lineStyle(2, 0x4a3420);
      g.lineBetween(pw / 2, ph - 30, pw / 2, ph - 6);
      g.lineBetween(pw / 2 - 18, ph - 30, pw / 2 + 18, ph - 6);
      g.fillStyle(0xd4a373);
      g.fillRect(10, ph - 20, 14, 14);
      g.fillRect(26, ph - 20, 14, 14);
      g.fillRect(18, ph - 33, 14, 13);
    } else if (def.id === 'tavern') {
      // Warm windows and a hanging mug sign.
      g.fillStyle(0xffb703);
      g.fillRect(12, ph - 26, 16, 14);
      g.fillRect(pw - 28, ph - 26, 16, 14);
      g.fillStyle(0x6b4f3a);
      g.fillRect(pw / 2 + 12, eave + 2, 14, 12);
      g.fillStyle(0xffd166);
      g.fillRect(pw / 2 + 15, eave + 4, 7, 8);
    } else if (def.id === 'netMaker') {
      // A net hung out to dry on the wall.
      g.lineStyle(1, 0x2b2d42, 0.8);
      for (let x = 10; x <= 42; x += 6) g.lineBetween(x, ph - 30, x + 6, ph - 8);
      for (let x = 16; x <= 48; x += 6) g.lineBetween(x, ph - 30, x - 6, ph - 8);
      g.fillStyle(0xa8def0);
      g.fillRect(pw - 36, ph - 28, 20, 14);
    } else if (def.id === 'fishMarket' || def.id === 'seafoodRestaurant') {
      // Striped awning over the front, crates of fish or warm windows beneath.
      const awningY = def.id === 'fishMarket' ? ph - 46 : ph - 34;
      const [a, b] = def.id === 'fishMarket' ? [0xc1121f, 0xfefae0] : [0x1d3557, 0xfefae0];
      for (let x = 8, i = 0; x < pw - 8; x += 12, i++) {
        g.fillStyle(i % 2 === 0 ? a : b);
        g.fillRect(x, awningY, 12, 10);
        g.fillTriangle(x, awningY + 10, x + 12, awningY + 10, x + 6, awningY + 15);
      }
      if (def.id === 'fishMarket') {
        g.fillStyle(0xd4a373);
        for (const x of [12, 34, pw - 58, pw - 36]) g.fillRect(x, ph - 22, 20, 14);
        g.fillStyle(0x8ecae6);
        for (const x of [16, 38, pw - 54, pw - 32]) g.fillEllipse(x + 6, ph - 18, 10, 5);
      } else {
        g.fillStyle(0xffd166);
        g.fillRect(12, ph - 20, 18, 12);
        g.fillRect(pw - 30, ph - 20, 18, 12);
        g.fillStyle(0xffe066);
        for (let x = 10; x < pw - 6; x += 9) g.fillCircle(x, awningY - 4 + Math.sin(x) * 1.5, 1.6);
      }
    } else if (def.id === 'boatyard') {
      // A wide shed with a half-built hull on the slipway.
      g.fillStyle(0x6b4f3a);
      g.fillRect(pw / 2 - 30, eave + 8, 60, ph - eave - 14);
      g.fillStyle(0x8d5524);
      g.fillEllipse(pw / 2, ph - 12, 70, 16);
      g.fillStyle(0xb08968);
      g.fillRect(pw / 2 - 35, ph - 12, 70, 6);
      g.lineStyle(2, 0x5c3a1e);
      for (let x = pw / 2 - 28; x <= pw / 2 + 28; x += 14) g.lineBetween(x, ph - 20, x, ph - 30);
    } else if (def.id === 'fishermansHut') {
      // Barrel by the door and a rod leaning on the wall.
      g.fillStyle(0x7f5539);
      g.fillRoundedRect(6, ph - 18, 10, 12, 2);
      g.lineStyle(2, 0x4a2f1a);
      g.lineBetween(pw - 10, ph - 6, pw - 2, eave - 6);
    } else if (def.id === 'bathhouse') {
      g.fillStyle(0xa8def0);
      g.fillRect(12, eave + 12, 14, 14);
      g.fillRect(pw - 26, eave + 12, 14, 14);
      g.fillRect(12, eave + 36, 14, 14);
      g.fillRect(pw - 26, eave + 36, 14, 14);
    } else if (def.w >= 4) {
      g.fillStyle(0xa8def0);
      g.fillRect(16, eave + 10, 22, 18);
      g.fillRect(pw - 38, eave + 10, 22, 18);
    } else if (def.id === 'cottage') {
      g.fillStyle(0xffe8a3);
      g.fillRect(12, ph - 26, 10, 10);
    }
    g.fillStyle(0x5c3a1e);
    g.fillRect(pw / 2 - 7, ph - 6 - doorH, 14, doorH);

    const parts: Phaser.GameObjects.GameObject[] = [g];
    if (def.id === 'playerHouse') parts.push(makePlayer(this).setPosition(pw / 2 + 18, ph - 4));
    if (def.id === 'waterMill') {
      // The wheel turns while millers are at work.
      const wheel = this.add.graphics();
      wheel.lineStyle(3, 0x5c3a1e).strokeCircle(0, 0, 13);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        wheel.lineBetween(0, 0, Math.cos(a) * 13, Math.sin(a) * 13);
        wheel.fillStyle(0x8b5a2b).fillRect(Math.cos(a) * 13 - 2, Math.sin(a) * 13 - 2, 4, 4);
      }
      wheel.setPosition(15, ph - 15); // inside the footprint, so it never overlaps a neighbour
      if (status?.keeper !== undefined && !status.dry) this.tweens.add({ targets: wheel, angle: 360, duration: 4000, repeat: -1 });
      parts.push(wheel);
    }
    if (def.id === 'fishStand') parts.push(this.add.image(pw / 2, eave + 10, 'fish-mackerel').setScale(0.7));
    if (def.id === 'filletHouse') {
      // A salmon on the sign with a little knife beside it.
      const knife = this.add.graphics();
      knife.fillStyle(0xdee2e6);
      knife.fillTriangle(pw / 2 + 20, eave - 2, pw / 2 + 34, eave - 6, pw / 2 + 34, eave + 1);
      knife.fillStyle(0x5c3a1e);
      knife.fillRect(pw / 2 + 34, eave - 6, 8, 5);
      parts.push(this.add.image(pw / 2 - 6, eave - 4, 'fish-salmon').setScale(0.55), knife);
    }
    if (def.id === 'tackleShop') parts.push(this.add.image(pw / 2, eave + 12, 'hook').setScale(1.4));
    if (def.id === 'baitShop') {
      const worm = this.add.graphics();
      worm.lineStyle(4, 0xe07a8f);
      worm.beginPath();
      worm.arc(pw / 2 - 4, eave + 10, 5, Math.PI, 0, false);
      worm.arc(pw / 2 + 6, eave + 10, 5, Math.PI, 0, true);
      worm.strokePath();
      parts.push(worm);
    }
    if (status) {
      if (def.maxLevel > 1) {
        parts.push(this.add.circle(pw - 10, 10, 10, 0x1d3557).setStrokeStyle(2, 0xffffff));
        parts.push(makeText(this, pw - 10, 10, `${status.level}`, 12).setOrigin(0.5));
      }
      if (status.keeper !== undefined) {
        // Shopkeeper waiting in the doorway, shifting their weight now and then.
        const keeper = makePerson(this, status.keeper).setPosition(pw / 2 + 13, ph - 5);
        this.tweens.add({ targets: keeper, scaleY: 1.06, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1 });
        parts.push(keeper);
      }
      if (status.dry) {
        // A waterside building cut off from the water.
        const pip = this.add.circle(10, 10, 9, 0x1e90ff).setStrokeStyle(2, 0xffffff);
        const mark = makeText(this, 10, 10, '!', 13).setOrigin(0.5);
        this.tweens.add({ targets: [pip, mark], scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
        parts.push(pip, mark);
      } else if (status.unstaffed) {
        // "Help wanted": a workplace with nobody working there
        const pip = this.add.circle(10, 10, 9, 0xe63946).setStrokeStyle(2, 0xffffff);
        const mark = makeText(this, 10, 10, '!', 13).setOrigin(0.5);
        this.tweens.add({ targets: [pip, mark], scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
        parts.push(pip, mark);
      }
    }
    return this.add.container(0, 0, parts);
  }

  /** A striped tower with a lamp room whose beam sweeps while keepers are on duty. */
  private lighthouseView(def: BuildingDef, status?: ViewStatus): Phaser.GameObjects.Container {
    const pw = def.w * TILE;
    const ph = def.h * TILE;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(pw / 2 + 3, ph - 4, pw - 6, 12);
    // Tapered tower in red and white bands
    const top = 30;
    const band = (ph - top) / 5;
    for (let i = 0; i < 5; i++) {
      const y0 = top + i * band;
      const inset = 14 - (i * 6) / 5;
      g.fillStyle(i % 2 === 0 ? def.roof : def.wall);
      g.fillRect(inset, y0, pw - inset * 2, band + 1);
    }
    g.fillStyle(0x5c3a1e);
    g.fillRect(pw / 2 - 5, ph - 18, 10, 14);
    // Lamp room and cap
    g.fillStyle(0x343a40);
    g.fillRect(14, top - 4, pw - 28, 4);
    g.fillStyle(0xffe066);
    g.fillRect(18, top - 18, pw - 36, 14);
    g.fillStyle(def.roof);
    g.fillTriangle(14, top - 18, pw / 2, top - 32, pw - 14, top - 18);

    const parts: Phaser.GameObjects.GameObject[] = [g];
    if (status?.keeper !== undefined) {
      const beam = this.add.triangle(pw / 2, top - 11, 0, 0, 70, -10, 70, 10, 0xfff3b0, 0.35).setOrigin(0, 0.5);
      this.tweens.add({ targets: beam, scaleX: -1, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      parts.push(beam);
    }
    if (status) {
      if (def.maxLevel > 1) {
        parts.push(this.add.circle(pw - 6, top + 4, 10, 0x1d3557).setStrokeStyle(2, 0xffffff));
        parts.push(makeText(this, pw - 6, top + 4, `${status.level}`, 12).setOrigin(0.5));
      }
      if (status.unstaffed) {
        const pip = this.add.circle(6, top + 4, 9, 0xe63946).setStrokeStyle(2, 0xffffff);
        const mark = makeText(this, 6, top + 4, '!', 13).setOrigin(0.5);
        this.tweens.add({ targets: [pip, mark], scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
        parts.push(pip, mark);
      }
    }
    return this.add.container(0, 0, parts);
  }

  /** Decor with its little bit of life: glowing lamps, a bubbling fountain. */
  private decorView(def: BuildingDef, placed?: PlacedBuilding): Phaser.GameObjects.Container {
    if (def.id === 'mooredBoats') return this.boatView(placed);
    if (def.trophy) return this.trophyView(def.trophy);
    const view = this.add.container(0, 0, [this.drawDecor(def)]);
    if (def.id === 'lampPost') {
      const glow = this.add.circle(TILE / 2, 8, 13, 0xffe066, 0.18);
      view.addAt(glow, 0);
      this.tweens.add({ targets: glow, alpha: 0.45, scale: 1.25, duration: 1400 + Math.random() * 600, yoyo: true, repeat: -1 });
    }
    if (def.id === 'fountain') {
      const spout = this.add.circle(TILE, TILE - 3, 3, 0xffffff, 0.9);
      const ripple = this.add.circle(TILE, TILE, 9).setStrokeStyle(2, 0xffffff, 0.6);
      view.add([ripple, spout]);
      this.tweens.add({ targets: spout, y: TILE - 9, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.tweens.add({ targets: ripple, scale: 2.1, alpha: 0, duration: 1600, repeat: -1 });
    }
    return view;
  }

  /** A stone plinth with the legendary fish mounted on top, glinting. */
  private trophyView(fishId: string): Phaser.GameObjects.Container {
    const s = TILE * 2;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.2).fillEllipse(s / 2, s - 6, s - 10, 12);
    g.fillStyle(0x8d99ae).fillRect(12, s - 26, s - 24, 20);
    g.fillStyle(0xadb5bd).fillRect(8, s - 30, s - 16, 6);
    g.fillStyle(0xffd166).fillRect(s / 2 - 10, s - 18, 20, 5);
    const type = FISH.find((f) => f.id === fishId)!;
    const fish = this.add.image(s / 2, s - 44, `fish-${fishId}`).setScale(Math.min(1, (s - 8) / (type.width * 1.6)));
    const shine = this.add.ellipse(s / 2, s - 44, fish.displayWidth + 12, fish.displayHeight + 12).setStrokeStyle(2, 0xffd166, 0.7);
    this.tweens.add({ targets: shine, alpha: 0.2, duration: 900, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: fish, y: fish.y - 3, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return this.add.container(0, 0, [g, shine, fish]);
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
    const jetty = this.add.graphics();
    jetty.fillStyle(0x8b5a2b).fillRect(6, 6, TILE - 12, TILE - 12);
    jetty.fillStyle(0x6b4423);
    for (let y = 9; y < TILE - 6; y += 5) jetty.fillRect(6, y, TILE - 12, 1);
    jetty.fillStyle(0x5c3a1e).fillRect(TILE / 2 - 2, TILE / 2 - 2, 4, 4); // mooring post
    const boat = this.add.graphics();
    boat.fillStyle(0x7f4f24).fillEllipse(0, 0, 22, 10);
    boat.fillStyle(0xd4a373).fillEllipse(0, -1, 16, 6);
    boat.fillStyle(0x5c3a1e).fillRect(-1, -4, 2, 6);
    boat.setPosition(TILE / 2 + dx * TILE * 0.75, TILE / 2 + dy * TILE * 0.75);
    if (dy !== 0) boat.setAngle(90);
    this.tweens.add({ targets: boat, y: boat.y + 2, duration: 1300 + Math.random() * 500, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    return this.add.container(0, 0, placed ? [jetty, boat] : [boat.setPosition(TILE / 2, TILE / 2)]);
  }

  /** Small props: decorations, and a road tile for the build menu preview. */
  private drawDecor(def: BuildingDef): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    const s = TILE;
    switch (def.id) {
      case 'road':
        g.fillStyle(0xcbb89d);
        g.fillRect(0, 0, s, s);
        g.lineStyle(2, 0x9c8a70);
        g.strokeRect(1, 1, s - 2, s - 2);
        break;
      case 'canal':
        g.fillStyle(0x3fa7d6);
        g.fillRect(0, 0, s, s);
        g.fillStyle(0x8d99ae);
        g.fillRect(0, 0, 3, s);
        g.fillRect(s - 3, 0, 3, s);
        g.fillStyle(0x7fd1f0, 0.7);
        g.fillRect(8, 9, 9, 2);
        g.fillRect(14, 19, 8, 2);
        break;
      case 'flowerBed':
        g.fillStyle(0x7f5539);
        g.fillRoundedRect(3, 9, s - 6, s - 14, 4);
        for (const [x, y, c] of [[9, 14, 0xff6b9a], [16, 12, 0xffd166], [22, 15, 0xf28482], [12, 19, 0xcdb4db], [20, 20, 0xffffff]]) {
          g.fillStyle(c);
          g.fillCircle(x, y, 3);
        }
        break;
      case 'tree':
        g.fillStyle(0x000000, 0.15);
        g.fillEllipse(s / 2, s - 4, 22, 7);
        g.fillStyle(0x6b4f3a);
        g.fillRect(s / 2 - 2, s / 2, 4, s / 2 - 3);
        g.fillStyle(0x2d6a4f);
        g.fillCircle(s / 2, s / 2 - 2, 11);
        g.fillStyle(0x40916c);
        g.fillCircle(s / 2 - 3, s / 2 - 5, 7);
        break;
      case 'bench':
        g.fillStyle(0x5c3a1e);
        g.fillRect(6, 18, 3, 7);
        g.fillRect(s - 9, 18, 3, 7);
        g.fillStyle(0x8b5a2b);
        g.fillRect(4, 9, s - 8, 4);
        g.fillRect(4, 15, s - 8, 5);
        break;
      case 'lampPost':
        g.fillStyle(0xffe066, 0.25);
        g.fillCircle(s / 2, 8, 11);
        g.fillStyle(0x495057);
        g.fillRect(s / 2 - 1.5, 8, 3, s - 11);
        g.fillRect(s / 2 - 5, s - 5, 10, 3);
        g.fillStyle(0xffe066);
        g.fillCircle(s / 2, 8, 5);
        break;
      case 'statue': {
        // Plinth with a fisher holding up a big catch.
        g.fillStyle(0x000000, 0.2).fillEllipse(s, 2 * s - 6, 2 * s - 12, 12);
        g.fillStyle(0x8d99ae).fillRect(12, 2 * s - 24, 2 * s - 24, 18);
        g.fillStyle(0xadb5bd).fillRect(8, 2 * s - 28, 2 * s - 16, 6);
        g.fillStyle(0xb08d57);
        g.fillRect(s - 5, 2 * s - 52, 10, 24);
        g.fillCircle(s, 2 * s - 58, 7);
        g.fillRect(s + 4, 2 * s - 66, 4, 20);
        g.fillEllipse(s + 14, 2 * s - 66, 20, 8);
        break;
      }
      case 'clockTower': {
        g.fillStyle(0x000000, 0.2).fillRect(10, 2 * s - 8, 2 * s - 14, 8);
        g.fillStyle(0xc9ada7).fillRect(14, 4, 2 * s - 28, 2 * s - 8);
        g.fillStyle(0x4a4e69).fillTriangle(10, 8, s, -18, 2 * s - 10, 8);
        g.fillStyle(0xfefae0).fillCircle(s, 22, 11);
        g.lineStyle(2, 0x222222);
        g.lineBetween(s, 22, s, 14);
        g.lineBetween(s, 22, s + 6, 22);
        g.fillStyle(0x6b4f3a).fillRect(s - 6, 2 * s - 20, 12, 16);
        break;
      }
      case 'grandLighthouse': {
        // 2×4: tall striped tower with a big lamp.
        const h = 4 * s;
        g.fillStyle(0x000000, 0.2).fillEllipse(s, h - 6, 2 * s - 8, 12);
        g.fillStyle(0x6c757d).fillRect(8, h - 22, 2 * s - 16, 18);
        for (let i = 0; i < 5; i++) {
          g.fillStyle(i % 2 === 0 ? 0xf8f9fa : 0xd62828);
          g.fillRect(14 + i, 24 + i * 16, 2 * s - 28 - 2 * i, 16);
        }
        g.fillStyle(0x333333).fillRect(12, 10, 2 * s - 24, 14);
        g.fillStyle(0xffe066).fillRect(16, 12, 2 * s - 32, 10);
        g.fillStyle(0xd62828).fillTriangle(10, 10, s, -8, 2 * s - 10, 10);
        break;
      }
      case 'harborGate': {
        // 4×2: a stone arch with flags.
        const w = 4 * s;
        g.fillStyle(0x000000, 0.2).fillRect(6, 2 * s - 8, w - 12, 8);
        g.fillStyle(0xadb5bd);
        g.fillRect(8, 10, 22, 2 * s - 12);
        g.fillRect(w - 30, 10, 22, 2 * s - 12);
        g.fillRect(8, 6, w - 16, 16);
        g.fillStyle(0x8d99ae).fillRect(8, 20, w - 16, 4);
        g.fillStyle(0xffd166).fillRect(w / 2 - 22, 9, 44, 9);
        for (const fx of [14, w - 20]) {
          g.fillStyle(0x5c3a1e).fillRect(fx, -18, 2, 26);
          g.fillStyle(0x1d3557).fillTriangle(fx + 2, -18, fx + 16, -13, fx + 2, -8);
        }
        break;
      }
      case 'fountain': {
        const c = s; // 2×2 footprint: centre at one tile in
        g.fillStyle(0xadb5bd);
        g.fillCircle(c, c, c - 3);
        g.fillStyle(0x48cae4);
        g.fillCircle(c, c, c - 8);
        g.fillStyle(0xdee2e6);
        g.fillCircle(c, c, 7);
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(c, c - 3, 3);
        break;
      }
    }
    return g;
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
    const counts = workerCounts();
    const wet = wateredTiles();
    const alive = new Set<number>();
    this.drawTiles();
    for (const b of state.buildings) {
      if (defOf(b).category === 'tile') continue;
      alive.add(b.id);
      const keeper = jobSlots(b) > 0 ? state.residents.find((r) => r.job === b.id)?.id : undefined;
      const dry = !!defOf(b).needsWater && !touchesWater(b, wet);
      const status: ViewStatus = { level: b.level, unstaffed: jobSlots(b) > 0 && !counts.get(b.id), keeper, dry };
      const old = this.viewStatus.get(b.id);
      const view = this.buildingViews.get(b.id);
      const changed = !old || old.level !== status.level || old.unstaffed !== status.unstaffed || old.keeper !== keeper;
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
   * Roads and canals share one layer, each drawn as connected strips: edges only where a tile has
   * no neighbour of the same kind. Canals joined to the sea are water; the rest are dry ditches.
   */
  private drawTiles(): void {
    const tiles = state.buildings.filter((b) => defOf(b).category === 'tile');
    const wet = wateredTiles();
    const key = tiles.map((t) => `${t.type}${t.col},${t.row}${wet.has(`${t.col},${t.row}`) ? 'w' : ''}`).join('|');
    if (key === this.tileKey) return;
    this.tileKey = key;
    const g = this.tileGfx.clear();
    const at = (type: string) => new Set(tiles.filter((t) => t.type === type).map((t) => `${t.col},${t.row}`));
    const kinds = { road: at('road'), canal: at('canal') };

    for (const t of tiles) {
      if (t.type === 'bridge') continue;
      const p = tileToWorld(t.col, t.row, 1);
      const same = t.type === 'canal' ? kinds.canal : kinds.road;
      const isWet = t.type === 'canal' && wet.has(`${t.col},${t.row}`);
      const [fill, edge] = t.type === 'road' ? [0xcbb89d, 0x9c8a70] : isWet ? [0x3fa7d6, 0x8d99ae] : [0x9c6644, 0x6b4f3a];
      g.fillStyle(fill);
      g.fillRect(p.x, p.y, TILE, TILE);
      if (isWet) {
        g.fillStyle(0x7fd1f0, 0.6);
        g.fillRect(p.x + 7, p.y + 9, 9, 2);
        g.fillRect(p.x + 15, p.y + 19, 8, 2);
      }
      // A canal in the bottom row cuts through the beach into the sea.
      const openToSea = t.type === 'canal' && t.row === 0;
      if (openToSea) {
        g.fillStyle(0x3fa7d6);
        g.fillRect(p.x, p.y + TILE, TILE, SHORE_H + 2);
      }
      const w = t.type === 'canal' ? 3 : 2;
      g.fillStyle(edge);
      if (!same.has(`${t.col},${t.row + 1}`)) g.fillRect(p.x, p.y, TILE, w);
      if (!same.has(`${t.col},${t.row - 1}`) && !openToSea) g.fillRect(p.x, p.y + TILE - w, TILE, w);
      if (!same.has(`${t.col - 1},${t.row}`)) g.fillRect(p.x, p.y, w, TILE + (openToSea ? SHORE_H : 0));
      if (!same.has(`${t.col + 1},${t.row}`)) g.fillRect(p.x + TILE - w, p.y, w, TILE + (openToSea ? SHORE_H : 0));
      if (openToSea) {
        // The boardwalk crosses the canal mouth on a little plank bridge, gaps showing the water.
        const top = p.y + TILE + 3;
        for (let y = top; y < top + SHORE_H - 10; y += 8) {
          g.fillStyle(0xb07d4f);
          g.fillRect(p.x - 2, y, TILE + 4, 5);
        }
        g.fillStyle(0x6b4423);
        g.fillRect(p.x - 2, top - 2, TILE + 4, 2);
        g.fillRect(p.x - 2, top + SHORE_H - 12, TILE + 4, 2);
      }
    }
    this.drawBridges(g, tiles, kinds.canal);
  }

  /** Wooden bridge decks across canals, planks running the way people walk, rails on the sides. */
  private drawBridges(g: Phaser.GameObjects.Graphics, tiles: PlacedBuilding[], canals: Set<string>): void {
    for (const t of tiles) {
      if (t.type !== 'bridge') continue;
      const p = tileToWorld(t.col, t.row, 1);
      // A canal flowing left-right is crossed up-down, and vice versa.
      const flowsSideways = canals.has(`${t.col - 1},${t.row}`) || canals.has(`${t.col + 1},${t.row}`);
      g.fillStyle(0xb07d4f).fillRect(p.x + 1, p.y + 1, TILE - 2, TILE - 2);
      g.fillStyle(0x8b5a2b);
      for (let i = 6; i < TILE - 2; i += 6) {
        if (flowsSideways) g.fillRect(p.x + 1, p.y + i, TILE - 2, 1);
        else g.fillRect(p.x + i, p.y + 1, 1, TILE - 2);
      }
      g.fillStyle(0x5c3a1e);
      if (flowsSideways) {
        g.fillRect(p.x, p.y, 3, TILE);
        g.fillRect(p.x + TILE - 3, p.y, 3, TILE);
      } else {
        g.fillRect(p.x, p.y, TILE, 3);
        g.fillRect(p.x, p.y + TILE - 3, TILE, 3);
      }
    }
  }

  /** Chimney top in building-local px, for homes. */
  private chimneyOf(def: BuildingDef): { x: number; y: number } | undefined {
    if (def.id === 'cottage') return { x: def.w * TILE * 0.68 + 3.5, y: 8 };
    if (def.id === 'apartment') return { x: def.w * TILE * 0.74, y: 18 };
    if (def.id === 'playerHouse') return { x: def.w * TILE * 0.72, y: 16 };
    if (def.id === 'bathhouse') return { x: def.w * TILE * 0.7, y: 24 };
    return undefined;
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
      const puff = this.add.circle(pos.x + chimney.x, pos.y + chimney.y - 2, 3.5, 0xeeeeee, 0.65).setDepth(30);
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
    const bg = () => this.add.rectangle(0, GAME_HEIGHT - BOTTOM_BAR_H, GAME_WIDTH, BOTTOM_BAR_H, 0x000000, 0.35).setOrigin(0);

    this.questButton = makeButton(this, GAME_WIDTH / 2, y, 132, 56, 'Quests', () => this.openQuests(), COLORS.buy, 20);
    // Red badge with the number of quests ready to claim.
    this.questBadgeText = makeText(this, 0, 0, '', 13).setOrigin(0.5);
    this.questBadge = this.add.container(GAME_WIDTH / 2 + 58, y - 26, [
      this.add.circle(0, 0, 11, 0xe63946).setStrokeStyle(2, 0xffffff),
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
    const ok = fits && state.coins >= cost;
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
      if (o.current) row.add(makeText(this, GAME_WIDTH - 44, y, '✓', 20).setOrigin(1, 0.5).setColor('#8ee88e'));
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
      const card = this.add.rectangle(GAME_WIDTH / 2, y + cardH / 2 - 4, GAME_WIDTH - 64, cardH - 12, 0x264b73);
      if (q.done) card.setStrokeStyle(2, 0x8ee88e);
      else if (q.daily) card.setStrokeStyle(2, 0xffd166);
      m.add(card);
      m.text(46, y + 18, describeQuest(q), 17, 0);

      // Progress bar
      const barW = 210;
      const frac = q.amount > 0 ? progress / q.amount : 1;
      m.add(this.add.rectangle(46, y + 48, barW, 14, 0x0b2545).setOrigin(0, 0.5));
      m.add(this.add.rectangle(46, y + 48, Math.max(2, barW * frac), 14, q.done ? 0x52b788 : 0xf5a623).setOrigin(0, 0.5));
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
        swap.setEnabledLook(state.coins >= cost, COLORS.neutral);
        m.add(swap);
      }
      y += cardH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral));
  }

  /** Orders from shops: fish from the Icehouse for coins and a lasting income boost. */
  private openOrders(): void {
    this.leaveModes();
    const cardH = 118;
    const unlocked = ordersUnlocked();
    const m = (this.modal = new Modal(this, 170 + Math.max(1, state.orders.length) * cardH));
    this.boardTabs(m, 'orders');
    const cap = crateCapacity();
    const sub = !unlocked
      ? `Orders start at house level ${ORDERS.unlockLevel}`
      : cap === 0
        ? 'Build an Icehouse to keep fish for orders'
        : `Each delivery: +${ORDERS.boostPerDelivery * 100}% income there, for good · Icehouse ${cratesUsed()}/${cap}`;
    m.text(GAME_WIDTH / 2, m.top + 70, sub, 13).setAlpha(0.8).setWordWrapWidth(GAME_WIDTH - 70).setAlign('center');
    if (unlocked && state.orders.length === 0) m.text(GAME_WIDTH / 2, m.top + 120, 'No orders right now. Check back soon!', 16).setAlpha(0.8);

    let y = m.top + 100;
    for (const o of state.orders) {
      const have = Math.min(o.amount, onIce(o.fish));
      const ready = canDeliver(o);
      const card = this.add.rectangle(GAME_WIDTH / 2, y + cardH / 2 - 4, GAME_WIDTH - 64, cardH - 12, 0x264b73);
      if (ready) card.setStrokeStyle(2, 0x8ee88e);
      m.add(card);
      m.text(46, y + 18, orderTitle(o), 16, 0).setWordWrapWidth(GAME_WIDTH - 100);
      const barW = 210;
      m.add(this.add.rectangle(46, y + 48, barW, 14, 0x0b2545).setOrigin(0, 0.5));
      m.add(this.add.rectangle(46, y + 48, Math.max(2, (barW * have) / o.amount), 14, ready ? 0x52b788 : 0xf5a623).setOrigin(0, 0.5));
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

  /** What's on ice, with a way to sell it all. */
  private openIcehouse(b: PlacedBuilding): void {
    this.closeModal();
    this.panelFor = undefined;
    const entries = Object.entries(state.crates).filter(([, n]) => n > 0).sort((a, z) => z[1] - a[1]);
    const rowH = 30;
    const m = (this.modal = new Modal(this, 220 + Math.max(1, Math.ceil(entries.length / 2)) * rowH));
    m.text(GAME_WIDTH / 2, m.top + 30, 'On ice', 26);
    m.text(GAME_WIDTH / 2, m.top + 62, `${cratesUsed()}/${crateCapacity()} fish · keep them from the catch screen`, 13).setAlpha(0.8);
    if (entries.length === 0) m.text(GAME_WIDTH / 2, m.top + 110, 'Empty', 16).setAlpha(0.6);
    entries.forEach(([id, n], i) => {
      const x = i % 2 === 0 ? 50 : GAME_WIDTH / 2 + 10;
      m.text(x, m.top + 104 + Math.floor(i / 2) * rowH, `${fishName(id)} ×${n}`, 16, 0);
    });
    const value = entries.reduce((sum, [id, n]) => sum + FISH.find((f) => f.id === id)!.value * n, 0);
    const sell = makeButton(this, GAME_WIDTH / 2, m.top + m.height - 92, 200, 44, `Sell all $${formatCoins(value)}`, () => {
      const coins = sellCrates();
      if (coins > 0) showToast(this, `+$${formatCoins(coins)}`);
      this.openIcehouse(b);
    }, COLORS.danger, 18);
    sell.setEnabledLook(value > 0, COLORS.danger);
    m.add(sell, makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Back', () => this.openBuildingPanel(b), COLORS.neutral));
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
    const rowH = 100;
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
      const preview = this.drawBuilding(def).setScale(Math.min(1.4, 56 / (Math.max(def.w, def.h) * TILE)));
      preview.setPosition(36, y - 28);
      m.add(preview);
      m.text(110, y - 34, def.name, 18, 0);
      m.text(110, y - 12, this.buildSummary(def), 13, 0).setColor(COLORS.gold);
      m.text(110, y + 2, def.description, 13, 0).setOrigin(0, 0).setWordWrapWidth(190).setAlpha(0.8);
      const water = def.needsWater ? ' · needs water' : '';
      if (levelLimited) {
        m.text(110, y + 38, `Owned ${owned}/${cap} · more at house Lv ${townLevel() + 1}`, 12, 0).setColor('#ffb4a2');
      } else if (def.maxCount > 1 && def.category !== 'tile' && def.category !== 'decor') {
        m.text(110, y + 38, `Owned ${owned}/${cap}${water}`, 12, 0).setColor(water ? '#8ecae6' : '#ffffff').setAlpha(water ? 1 : 0.6);
      } else if (water) {
        m.text(110, y + 38, 'Needs water (beside a canal)', 12, 0).setColor('#8ecae6');
      }
      const unlocked = isUnlocked(def);
      // Trophies wait for their legendary fish rather than a house level.
      const needsFish = !!def.trophy && !unlocked;
      if (!unlocked) {
        preview.setAlpha(0.35);
        const why = needsFish ? `Catch the legendary ${FISH.find((f) => f.id === def.trophy)!.name}` : `Unlocks at house level ${def.unlockLevel}`;
        m.text(110, y + 38, why, 12, 0).setColor('#ffb4a2');
      }
      const affordable = state.coins >= cost;
      const label = needsFish ? 'Catch' : !unlocked ? `Lv ${def.unlockLevel}` : maxed ? (def.maxCount === 1 ? 'Built' : 'Max') : `$${formatCoins(cost)}`;
      const btn = makeButton(this, GAME_WIDTH - 80, y, 100, 46, label, () => {
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
    if (def.happiness) return `${size} · +${def.happiness.amount} mood · ${def.happiness.radius} tiles`;
    const jobs = def.jobs?.(1) ?? 0;
    const pay = def.incomePerWorker?.(1) ?? 0;
    const jobText = `${jobs} job${jobs === 1 ? '' : 's'}`;
    const boost = def.standBoostPerWorker?.(1);
    if (boost) return `${size} · ${jobText} · +${Math.round(boost * 100)}% Fish Stands each`;
    // Kept short (no size) so the line fits beside the price button.
    if (def.offlineHoursPerWorker) return `${jobText} · +${def.offlineHoursPerWorker(1)}h cap each`;
    if (def.moodPerWorker) return `${jobText} · +${def.moodPerWorker.amount(1)} mood each`;
    if (def.hookPerWorker) return `${jobText} · +${def.hookPerWorker} fish each`;
    if (def.sonarPerWorker) return `${jobText} · +${def.sonarPerWorker(1)}m sonar each`;
    if (def.dockPricePerWorker) return `${jobText} · +${Math.round(def.dockPricePerWorker(1) * 100)}% dock price each`;
    if (def.millPerWorker) return `${jobText} · +${def.millPerWorker.amount * 100}% nearby each`;
    if (def.id === 'boatyard') return `${jobText} · builds boats`;
    if (def.crateCapacity) return `${size} · holds ${def.crateCapacity(1)} fish`;
    if (def.cansPerWorker) return `${jobText} · ${def.cansPerWorker(1)} cans/min each`;
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
      (def.id === 'baitShop' || def.id === 'boatyard' || def.id === 'aquarium' || def.id === 'icehouse' ? 66 : 0) +
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
      const parts = [`base ${mood.base}`, `decor +${mood.decor}`, `road +${mood.road}`];
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
      const star = makeButton(this, right, y, 120, 38, b.priority ? '★ Priority' : '☆ Priority', () => {
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
      if (!maxed) {
        if (waiting) m.text(40, y + 14, `Needs your house at Lv ${b.level + 1}`, 14, 0).setColor('#ffb4a2');
        else m.text(40, y + 14, this.upgradeGain(b), 14, 0).setAlpha(0.75);
        if (need) {
          m.text(40, y + 36, `${fishOk ? '✓' : '✗'} ${need.amount} ${fishName(need.fish)} on ice (have ${onIce(need.fish)})`, 13, 0)
            .setColor(fishOk ? '#8ee88e' : '#ff8a8a');
        }
        const label = waiting ? `House ${b.level + 1}` : `$${formatCoins(cost)}`;
        const btn = makeButton(this, right, y, 110, 46, label, () => {
          if (upgradeBuilding(b)) {
            sfx.place();
            reopen();
          }
        }, COLORS.buy, waiting ? 16 : 18);
        btn.setEnabledLook(!waiting && fishOk && state.coins >= cost, COLORS.buy);
        m.add(btn);
      }
      y += need ? 92 : 70;
    }

    // Fishing gear sold here
    const open = sells.length > 0 && shopOpen(def.id);
    for (const up of sells) {
      const level = state.upgrades[up.id];
      const cap = upgradeLevelCap(up);
      const upCost = upgradeCost(up, level);
      m.text(40, y - 12, up.name, 18, 0);
      const desc = level >= up.maxLevel ? `${up.describe(level)} (max)` : `${up.describe(level)} → ${up.describe(level + 1)}`;
      m.text(40, y + 14, desc, 14, 0).setAlpha(0.75);
      if (level < up.maxLevel) {
        const locked = level >= cap;
        const label = !open ? 'Closed' : locked ? `Shop Lv${b.level + 1}` : `$${formatCoins(upCost)}`;
        const btn = makeButton(this, right, y, 110, 46, label, () => {
          if (buyUpgrade(up)) reopen();
        }, COLORS.buy, open && !locked ? 18 : 15);
        btn.setEnabledLook(open && !locked && state.coins >= upCost, COLORS.buy);
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

    if (def.id === 'icehouse') {
      m.text(40, y - 12, `On ice ${cratesUsed()}/${crateCapacity()}`, 18, 0);
      m.text(40, y + 14, 'For orders and upgrades', 14, 0).setAlpha(0.75);
      m.add(makeButton(this, right, y, 110, 46, 'Look ›', () => this.openIcehouse(b), COLORS.primary, 18));
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
    const open = shopOpen('baitShop');
    m.text(GAME_WIDTH / 2, m.top + 30, 'Bait', 26);
    m.text(GAME_WIDTH / 2, m.top + 62, 'One bait is used per cast. Pick it on the dock.', 14).setAlpha(0.8);

    let y = m.top + 116;
    for (const bait of BAITS) {
      const unlocked = baitUnlocked(bait);
      const owned = state.bait[bait.id] ?? 0;
      m.add(this.add.circle(48, y, 13, bait.color).setStrokeStyle(2, 0x000000, 0.3).setAlpha(unlocked ? 1 : 0.35));
      m.text(74, y - 24, `${bait.name} ×${bait.packSize}`, 18, 0);
      m.text(74, y, `+${Math.round(bait.sellBonus * 100)}% sale · ${bait.lures}`, 13, 0).setColor(COLORS.gold);
      m.text(74, y + 20, unlocked ? `Owned ${owned}` : `Unlocks at house level ${bait.unlockLevel}`, 12, 0).setColor(
        unlocked ? '#ffffff' : '#ffb4a2',
      ).setAlpha(unlocked ? 0.65 : 1);
      const label = !unlocked ? `Lv ${bait.unlockLevel}` : !open ? 'Closed' : `$${formatCoins(bait.packCost)}`;
      const btn = makeButton(this, GAME_WIDTH - 80, y, 100, 46, label, () => {
        if (buyBait(bait)) this.openBaitStore(shop);
      }, COLORS.buy, 18);
      btn.setEnabledLook(unlocked && open && state.coins >= bait.packCost, COLORS.buy);
      m.add(btn);
      y += rowH;
    }
    if (!open) m.text(GAME_WIDTH / 2, y - 16, 'Closed: the Bait Shop needs a shopkeeper.', 14).setColor('#ff8a8a');
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
        .setWordWrapWidth(GAME_WIDTH - 200);
      if (!unlocked) m.text(74, y + 32, `Unlocks at house level ${area.unlockLevel}`, 12, 0).setColor('#ffb4a2');
      const label = owned ? 'Owned' : !unlocked ? `Lv ${area.unlockLevel}` : !open ? 'Closed' : `$${formatCoins(area.cost)}`;
      const btn = makeButton(this, GAME_WIDTH - 84, y - 8, 100, 46, label, () => {
        if (buyBoat(area)) this.openBoatStore(yard);
      }, COLORS.buy, 18);
      btn.setEnabledLook(!owned && unlocked && open && state.coins >= area.cost, COLORS.buy);
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
    const height = next ? (next.fish ? 450 : 424) : 260;
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
      m.text(40, y, `${residentsOk ? '✓' : '✗'} ${state.residents.length}/${next.residents} residents`, 15, 0).setColor(
        residentsOk ? '#8ee88e' : '#ff8a8a',
      );
      y += 26;
      if (next.fish) {
        const have = onIce(next.fish.fish);
        const ok = have >= next.fish.amount;
        m.text(40, y, `${ok ? '✓' : '✗'} ${next.fish.amount} ${fishName(next.fish.fish)} on ice (have ${have})`, 15, 0).setColor(
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
      btn.setEnabledLook(ready && state.coins >= next.cost, COLORS.buy);
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
      const pips = '●'.repeat(rank) + '○'.repeat(p.maxRank - rank);
      m.text(40, y - 16, `${p.name}  ${pips}`, 17, 0).setAlpha(open ? 1 : 0.5);
      const now = rank > 0 ? p.describe(rank) : 'Not learned yet';
      const next = rank < p.maxRank ? ` → ${p.describe(rank + 1)}` : '';
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
      const rate = canningRate();
      return `${state.cans}/${TRADE.maxCans} cans ($${formatCoins(state.cansValue)}) · ${fmtRate(rate)}/min from spare fish on ice`;
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
