import Phaser from 'phaser';
import {
  BUILDINGS,
  BUILDING_BY_ID,
  GAME_HEIGHT,
  GAME_WIDTH,
  GRID_X,
  ROWS_PER_EXPANSION,
  TILE,
  TOWN_COLS,
  UPGRADES,
  upgradeCost,
  type BuildingDef,
} from '../config';
import { tickEconomy } from '../economy';
import { state, type PlacedBuilding } from '../state';
import { makeTextures } from '../textures';
import {
  buildCost,
  buyUpgrade,
  canExpand,
  canPlace,
  countOwned,
  expand,
  moveBuilding,
  nextExpansionCost,
  placeBuilding,
  sellBuilding,
  sellValue,
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
  makeButton,
  makeText,
  showOfflineEarnings,
  type Button,
} from '../ui';

// World layout: grid rows grow upward from y = 0; the shore and dock sit below it.
const SHORE_H = 40;
const WORLD_BOTTOM = 360;
const DOCK = { x: GRID_X + 3 * TILE + 5, y: SHORE_H - 10, w: 50, h: 230 };
/** Space above the last unlocked row for the expansion strip and some forest. */
const TOP_MARGIN = ROWS_PER_EXPANSION * TILE + 160;
const BOTTOM_BAR_H = 90;
const DRAG_THRESHOLD = 8;
const INCOME_POP_MS = 4000;

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

  private modal?: Modal;
  private gesture?: Gesture;
  private velocity = 0;
  private ghost?: Ghost;

  private normalBar!: Phaser.GameObjects.Container;
  private buildBar!: Phaser.GameObjects.Container;
  private placeButton!: Button;
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super('Town');
  }

  create(): void {
    this.buildingViews = new Map();
    this.modal = undefined;
    this.gesture = undefined;
    this.ghost = undefined;
    this.velocity = 0;

    makeTextures(this);
    this.cameras.main.setBackgroundColor('#1b4332');
    this.ground = this.add.graphics().setDepth(0);
    this.gridLines = this.add.graphics().setDepth(1);
    this.drawShoreAndDock();
    this.rebuildGround();
    for (const b of state.buildings) this.addBuildingView(b);

    this.topBar = new TopBar(this);
    this.createBottomBars();
    this.setupInput();

    const cam = this.cameras.main;
    cam.scrollY = WORLD_BOTTOM - GAME_HEIGHT;

    this.time.addEvent({ delay: INCOME_POP_MS, loop: true, callback: () => this.showIncomePops() });
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    tickEconomy();
    this.topBar.update();
    if (!this.modal) this.modal = showOfflineEarnings(this, () => (this.modal = undefined));

    if (!this.gesture && Math.abs(this.velocity) > 5) {
      this.scrollTo(this.cameras.main.scrollY - this.velocity * dt);
      this.velocity *= Math.exp(-dt * 4);
    }
    if (this.ghost) this.refreshGhost();
  }

  // ------------------------------------------------------------- World

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

    // Unlocked land
    g.fillStyle(0x74c69d);
    g.fillRect(0, -rows * TILE, GAME_WIDTH, rows * TILE);
    g.fillStyle(0x95d5b2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < TOWN_COLS; c++) {
        if ((r + c) % 2 === 0) g.fillRect(GRID_X + c * TILE, -(r + 1) * TILE, TILE, TILE);
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
        if (expand()) {
          this.rebuildGround();
          this.cameras.main.setBounds(0, this.topY(), GAME_WIDTH, WORLD_BOTTOM - this.topY());
        }
      }, COLORS.buy, 20);
      this.expandButton.setDepth(3);
    }

    this.cameras.main.setBounds(0, top, GAME_WIDTH, WORLD_BOTTOM - top);
    this.drawGridLines();
  }

  private drawGridLines(): void {
    const rows = townRows();
    const g = this.gridLines.clear();
    g.lineStyle(1, 0x000000, this.ghost ? 0.25 : 0.06);
    for (let c = 0; c <= TOWN_COLS; c++) g.lineBetween(GRID_X + c * TILE, 0, GRID_X + c * TILE, -rows * TILE);
    for (let r = 0; r <= rows; r++) g.lineBetween(GRID_X, -r * TILE, GRID_X + TOWN_COLS * TILE, -r * TILE);
  }

  private drawShoreAndDock(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0xe9d8a6);
    g.fillRect(0, 0, GAME_WIDTH, SHORE_H);
    g.fillStyle(0x3fa7d6);
    g.fillRect(0, SHORE_H, GAME_WIDTH, WORLD_BOTTOM - SHORE_H);
    g.fillStyle(0xd6f1fb, 0.8);
    g.fillRect(0, SHORE_H, GAME_WIDTH, 4);

    // Pier
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

  private drawBuilding(def: BuildingDef, level?: number): Phaser.GameObjects.Container {
    const pw = def.w * TILE;
    const ph = def.h * TILE;
    const eave = ph * 0.42;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.18);
    g.fillRect(8, 10, pw - 10, ph - 12);
    g.fillStyle(def.wall);
    g.fillRect(6, eave - 4, pw - 12, ph - eave - 2);
    g.fillStyle(def.roof);
    g.fillTriangle(1, eave, pw / 2, 3, pw - 1, eave);
    g.fillStyle(0x5c3a1e);
    const doorH = Math.min(22, ph * 0.3);
    g.fillRect(pw / 2 - 7, ph - 6 - doorH, 14, doorH);
    if (def.w > 1) {
      g.fillStyle(0xa8def0);
      g.fillRect(16, eave + 10, 22, 18);
      g.fillRect(pw - 38, eave + 10, 22, 18);
    }

    const parts: Phaser.GameObjects.GameObject[] = [g];
    if (def.id === 'fishStand') parts.push(this.add.image(pw / 2, eave + 10, 'fish-mackerel').setScale(0.7));
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
    if (level !== undefined) {
      parts.push(this.add.circle(pw - 10, 10, 10, 0x1d3557).setStrokeStyle(2, 0xffffff));
      parts.push(makeText(this, pw - 10, 10, `${level}`, 12).setOrigin(0.5));
    }
    return this.add.container(0, 0, parts);
  }

  private addBuildingView(b: PlacedBuilding): void {
    const def = BUILDING_BY_ID[b.type];
    this.buildingViews.get(b.id)?.destroy();
    const view = this.drawBuilding(def, b.level);
    const pos = tileToWorld(b.col, b.row, def.h);
    // Lower rows draw in front so tall roofs overlap neatly.
    view.setPosition(pos.x, pos.y).setDepth(10 + (100 - b.row) * 0.01);
    this.buildingViews.set(b.id, view);
  }

  private buildingAt(col: number, row: number): PlacedBuilding | undefined {
    return state.buildings.find((b) => {
      const def = BUILDING_BY_ID[b.type];
      return col >= b.col && col < b.col + def.w && row >= b.row && row < b.row + def.h;
    });
  }

  private showIncomePops(): void {
    if (this.modal) return;
    const cam = this.cameras.main;
    for (const b of state.buildings) {
      const def = BUILDING_BY_ID[b.type];
      const amount = def.income(b.level) * (INCOME_POP_MS / 1000);
      if (amount <= 0) continue;
      const pos = tileToWorld(b.col, b.row, def.h);
      if (pos.y > cam.scrollY + GAME_HEIGHT || pos.y + def.h * TILE < cam.scrollY) continue;
      const label = `+$${amount < 10 ? amount.toFixed(1) : formatCoins(amount)}`;
      const pop = makeText(this, pos.x + (def.w * TILE) / 2, pos.y + 8, label, 15).setOrigin(0.5).setDepth(50);
      pop.setColor(COLORS.gold);
      this.tweens.add({ targets: pop, y: pop.y - 36, alpha: 0, duration: 1400, onComplete: () => pop.destroy() });
    }
  }

  // --------------------------------------------------------------- Input

  private setupInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.gesture = undefined;
      if (this.modal || over.length > 0) return;
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
    const tile = worldToTile(x, y);
    if (this.ghost) {
      const { def } = this.ghost;
      this.moveGhost(tile.col - Math.floor((def.w - 1) / 2), tile.row - Math.floor((def.h - 1) / 2));
      return;
    }
    const b = this.buildingAt(tile.col, tile.row);
    if (b && tile.col >= 0 && tile.col < TOWN_COLS && tile.row >= 0) {
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

    this.normalBar = this.add.container(0, 0, [
      bg(),
      makeButton(this, GAME_WIDTH * 0.28, y, 180, 56, 'Build', () => this.openBuildMenu()),
      makeButton(this, GAME_WIDTH * 0.72, y, 180, 56, 'Go Fish', () => this.scene.start('Fishing'), COLORS.neutral),
    ]);
    this.placeButton = makeButton(this, GAME_WIDTH * 0.72, y, 180, 56, 'Place', () => this.confirmPlacement(), COLORS.buy);
    this.buildBar = this.add.container(0, 0, [
      bg(),
      makeButton(this, GAME_WIDTH * 0.28, y, 180, 56, 'Cancel', () => this.exitBuildMode(), COLORS.danger),
      this.placeButton,
    ]);
    this.hint = makeText(this, GAME_WIDTH / 2, GAME_HEIGHT - BOTTOM_BAR_H - 22, 'Tap or drag to choose a spot', 17).setOrigin(0.5);

    for (const o of [this.normalBar, this.buildBar, this.hint]) fixToScreen(o).setDepth(UI_DEPTH);
    this.buildBar.setVisible(false);
    this.hint.setVisible(false);
  }

  private enterBuildMode(def: BuildingDef, moving?: PlacedBuilding): void {
    const view = this.drawBuilding(def, moving?.level).setAlpha(0.75);
    const outline = this.add.rectangle(0, 0, def.w * TILE, def.h * TILE).setOrigin(0).setStrokeStyle(3, 0xffffff);
    view.add(outline);
    view.setDepth(40);
    this.ghost = { def, col: 0, row: 0, view, outline, moving };
    // Leave a faint copy where the building stands now.
    if (moving) this.buildingViews.get(moving.id)?.setAlpha(0.3);

    const spot = moving ? { col: moving.col, row: moving.row } : this.findFreeSpot(def);
    this.moveGhost(spot.col, spot.row);
    const pos = tileToWorld(spot.col, spot.row, def.h);
    this.scrollTo(pos.y + (def.h * TILE) / 2 - GAME_HEIGHT / 2);

    this.normalBar.setVisible(false);
    this.buildBar.setVisible(true);
    this.hint.setVisible(true);
    this.drawGridLines();
  }

  private exitBuildMode(): void {
    const moving = this.ghost?.moving;
    if (moving) this.buildingViews.get(moving.id)?.setAlpha(1);
    this.ghost?.view.destroy();
    this.ghost = undefined;
    this.normalBar.setVisible(true);
    this.buildBar.setVisible(false);
    this.hint.setVisible(false);
    this.drawGridLines();
  }

  /** First free spot, searching outward from the rows currently on screen. */
  private findFreeSpot(def: BuildingDef): { col: number; row: number } {
    const cam = this.cameras.main;
    const centerRow = Phaser.Math.Clamp(worldToTile(0, cam.scrollY + GAME_HEIGHT / 2).row, 0, townRows() - 1);
    for (let d = 0; d < townRows(); d++) {
      for (const row of [centerRow - d, centerRow + d]) {
        for (let col = 0; col < TOWN_COLS; col++) if (canPlace(def, col, row)) return { col, row };
      }
    }
    return { col: 0, row: 0 };
  }

  private moveGhost(col: number, row: number): void {
    const g = this.ghost;
    if (!g) return;
    g.col = Phaser.Math.Clamp(col, 0, TOWN_COLS - g.def.w);
    g.row = Phaser.Math.Clamp(row, 0, townRows() - g.def.h);
    const pos = tileToWorld(g.col, g.row, g.def.h);
    g.view.setPosition(pos.x, pos.y);
  }

  private refreshGhost(): void {
    const g = this.ghost!;
    const cost = g.moving ? 0 : buildCost(g.def);
    const fits = canPlace(g.def, g.col, g.row, g.moving);
    const ok = fits && state.coins >= cost;
    g.outline.setStrokeStyle(3, fits ? 0x7cfc9a : 0xff5a5a).setFillStyle(fits ? 0x7cfc9a : 0xff5a5a, 0.25);
    this.placeButton.setEnabledLook(ok, COLORS.buy);
    this.placeButton.setLabel(g.moving ? 'Move here' : `Place $${formatCoins(cost)}`);
    this.hint.setText(fits ? 'Tap or drag to choose a spot' : 'That spot is taken');
  }

  private confirmPlacement(): void {
    const g = this.ghost;
    if (!g) return;
    if (g.moving) {
      if (!moveBuilding(g.moving, g.col, g.row)) return;
      const moved = g.moving;
      this.exitBuildMode();
      this.addBuildingView(moved);
      return;
    }
    const b = placeBuilding(g.def, g.col, g.row);
    if (!b) return;
    this.addBuildingView(b);
    const view = this.buildingViews.get(b.id)!;
    view.setScale(0.8);
    this.tweens.add({ targets: view, scale: 1, duration: 250, ease: 'Back.Out' });
    this.exitBuildMode();
  }

  // -------------------------------------------------------------- Panels

  private closeModal(): void {
    this.modal?.destroy();
    this.modal = undefined;
  }

  private openBuildMenu(): void {
    this.closeModal();
    const rowH = 112;
    const m = (this.modal = new Modal(this, 120 + BUILDINGS.length * rowH));
    m.text(GAME_WIDTH / 2, m.top + 32, 'Build', 28);

    let y = m.top + 110;
    for (const def of BUILDINGS) {
      const owned = countOwned(def.id);
      const cost = buildCost(def);
      const maxed = owned >= def.maxCount;
      const preview = this.drawBuilding(def).setScale(Math.min(1, 56 / (def.w * TILE)));
      preview.setPosition(36, y - 28);
      m.add(preview);
      m.text(110, y - 34, `${def.name}  ${def.w}×${def.h}`, 18, 0);
      m.text(110, y - 20, def.description, 13, 0).setOrigin(0, 0).setWordWrapWidth(185).setAlpha(0.8);
      if (def.maxCount > 1) m.text(110, y + 38, `Owned ${owned}/${def.maxCount}`, 12, 0).setAlpha(0.6);
      const affordable = state.coins >= cost;
      const btn = makeButton(this, GAME_WIDTH - 80, y, 100, 46, maxed ? 'Built' : `$${formatCoins(cost)}`, () => {
        if (maxed || !affordable) return;
        this.closeModal();
        this.enterBuildMode(def);
      }, COLORS.buy, 18);
      btn.setEnabledLook(!maxed && affordable, COLORS.buy);
      m.add(btn);
      y += rowH;
    }
    m.add(makeButton(this, GAME_WIDTH / 2, m.top + m.height - 34, 160, 44, 'Close', () => this.closeModal(), COLORS.neutral));
  }

  private openBuildingPanel(b: PlacedBuilding): void {
    this.closeModal();
    const def = BUILDING_BY_ID[b.type];
    const sells = UPGRADES.filter((u) => u.shop === def.id);
    const hasIncome = def.income(b.level) > 0;
    const m = (this.modal = new Modal(this, 300 + (hasIncome ? 40 : 0) + sells.length * 72));
    const reopen = () => this.openBuildingPanel(b);

    m.text(GAME_WIDTH / 2, m.top + 32, `${def.name}  ·  Lv ${b.level}`, 24);
    m.text(GAME_WIDTH / 2, m.top + 64, def.description, 14)
      .setAlpha(0.8)
      .setAlign('center')
      .setWordWrapWidth(GAME_WIDTH - 90);
    let y = m.top + 104;

    if (hasIncome) {
      const now = def.income(b.level);
      const next = def.income(b.level + 1);
      const fmt = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v).toString());
      const text = b.level < def.maxLevel ? `Income $${fmt(now)}/s → $${fmt(next)}/s` : `Income $${fmt(now)}/s`;
      m.text(40, y, text, 16, 0).setColor(COLORS.gold);
      y += 40;
    }
    const maxed = b.level >= def.maxLevel;
    const cost = def.upgradeCost(b.level);
    m.text(40, y, maxed ? 'Fully upgraded' : `Upgrade to Lv ${b.level + 1}`, 18, 0);
    if (!maxed) {
      const btn = makeButton(this, GAME_WIDTH - 90, y, 110, 46, `$${formatCoins(cost)}`, () => {
        if (upgradeBuilding(b)) {
          this.addBuildingView(b);
          reopen();
        }
      }, COLORS.buy, 18);
      btn.setEnabledLook(state.coins >= cost, COLORS.buy);
      m.add(btn);
    }

    // Fishing gear sold here
    y += 72;
    for (const up of sells) {
      const level = state.upgrades[up.id];
      const cap = upgradeLevelCap(up);
      const upCost = upgradeCost(up, level);
      m.text(40, y - 12, up.name, 18, 0);
      const desc = level >= up.maxLevel ? `${up.describe(level)} (max)` : `${up.describe(level)} → ${up.describe(level + 1)}`;
      m.text(40, y + 14, desc, 14, 0).setAlpha(0.75);
      if (level < up.maxLevel) {
        const locked = level >= cap;
        const btn = makeButton(this, GAME_WIDTH - 90, y, 110, 46, locked ? `Shop Lv${b.level + 1}` : `$${formatCoins(upCost)}`, () => {
          if (buyUpgrade(up)) reopen();
        }, COLORS.buy, locked ? 15 : 18);
        btn.setEnabledLook(!locked && state.coins >= upCost, COLORS.buy);
        m.add(btn);
      }
      y += 72;
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

  private confirmSell(b: PlacedBuilding): void {
    this.closeModal();
    const def = BUILDING_BY_ID[b.type];
    const sellsGear = UPGRADES.some((u) => u.shop === def.id);
    const value = sellValue(b);
    const m = (this.modal = new Modal(this, sellsGear ? 250 : 220));

    m.text(GAME_WIDTH / 2, m.top + 36, `Sell ${def.name}?`, 26);
    m.text(GAME_WIDTH / 2, m.top + 80, `You get $${formatCoins(value)} back.`, 18).setColor(COLORS.gold);
    if (sellsGear) m.text(GAME_WIDTH / 2, m.top + 112, 'Gear you already bought is kept.', 15).setAlpha(0.8);
    const buttonsY = m.top + m.height - 44;
    // Keep sits where the panel's Sell button was, so a double tap doesn't sell by accident.
    m.add(
      makeButton(this, GAME_WIDTH * 0.7, buttonsY, 150, 48, 'Keep', () => this.openBuildingPanel(b), COLORS.neutral),
      makeButton(this, GAME_WIDTH * 0.3, buttonsY, 150, 48, 'Sell', () => {
        this.closeModal();
        const pos = tileToWorld(b.col, b.row, def.h);
        sellBuilding(b);
        this.buildingViews.get(b.id)?.destroy();
        this.buildingViews.delete(b.id);
        const pop = makeText(this, pos.x + (def.w * TILE) / 2, pos.y + (def.h * TILE) / 2, `+$${formatCoins(value)}`, 22)
          .setOrigin(0.5)
          .setDepth(50)
          .setColor(COLORS.gold);
        this.tweens.add({ targets: pop, y: pop.y - 50, alpha: 0, duration: 1200, onComplete: () => pop.destroy() });
      }, COLORS.danger),
    );
  }
}
