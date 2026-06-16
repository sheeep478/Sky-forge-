// SkyForge — entry point. Wires the menu, renderer, world, player, mobs,
// input (desktop + touch), HUD and survival systems together.

// All game classes/constants (World, CHUNK, Player, MobManager, BLOCK,
// BLOCK_INFO, PALETTE, hashSeed, THREE) are globals from the scripts
// loaded before this one in index.html.

// ---------------- device + DOM ----------------
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const $ = (id) => document.getElementById(id);

const menuEl = $('menu'), loadingEl = $('loading'), hudEl = $('hud'),
      pauseEl = $('pause'), touchEl = $('touch-controls');

let selectedMode = 'survival';
let selectedWorld = 'regular';

// ---------------- menu wiring ----------------
function wireGroup(groupId, attr, set) {
  const group = $(groupId);
  group.querySelectorAll('.opt').forEach((b) => {
    b.addEventListener('click', () => {
      group.querySelectorAll('.opt').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      set(b.dataset[attr]);
    });
  });
}
wireGroup('mode-group', 'mode', (v) => (selectedMode = v));
wireGroup('world-group', 'world', (v) => (selectedWorld = v));

$('device-hint').textContent = isTouch
  ? 'Touch device: drag left to move, right to look. 🔥 lights portals.'
  : 'Desktop: click to lock mouse · WASD · Space jump · 1-9 blocks · G lights portal';

$('play-btn').addEventListener('click', startGame);

function migrateOldSave() {
  try {
    const old = localStorage.getItem('skyforge_save_v1');
    if (old && readIndex().length === 0) {
      const data = JSON.parse(old); const id = 'wlegacy'; data.id = id; data.name = 'World 1';
      localStorage.setItem(worldKey(id), JSON.stringify(data));
      writeIndex([{ id, name: 'World 1', mode: data.mode, type: data.type, updated: Date.now() }]);
      localStorage.removeItem('skyforge_save_v1');
    }
  } catch (e) {}
}

function wireMenu() {
  // settings open/close
  $('menu-settings-btn').addEventListener('click', () => openSettings('menu'));
  $('pause-settings-btn').addEventListener('click', () => openSettings('pause'));
  $('hud-settings-btn').addEventListener('click', () => openSettings('game'));
  $('settings-close').addEventListener('click', closeSettings);
  // settings controls
  $('set-sens').addEventListener('input', (e) => { settings.sensitivity = +e.target.value; syncSettingsUI(); applySettings(); saveSettings(); });
  $('set-size').addEventListener('input', (e) => { settings.btnScale = +e.target.value; syncSettingsUI(); applySettings(); saveSettings(); });
  $('set-left').addEventListener('click', () => { settings.leftHanded = !settings.leftHanded; syncSettingsUI(); applySettings(); saveSettings(); });
  $('set-invy').addEventListener('click', () => { settings.invertY = !settings.invertY; syncSettingsUI(); saveSettings(); });
  // chest close
  $('chest-close').addEventListener('click', closeChest);
  // persistence lifecycle
  window.addEventListener('pagehide', () => { try { saveGame(); } catch (e) {} });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { try { saveGame(); } catch (e) {} } });
}

// ---------------- game state ----------------
let renderer, scene, camera, world, player, mobs, sun;
let running = false, paused = false;
let lastTime = 0;
let hotbarIndex = 0;
const input = { mx: 0, mz: 0, jump: false, sprint: false, up: false, down: false };

// survival stats
let health = 20, hunger = 20, hungerTimer = 0, regenTimer = 0, lavaTimer = 0;

// dimensions (overworld <-> nether)
let gameSeed = 0, dimension = 'overworld';
let overworld = null, netherWorld = null, overworldMobs = null, netherMobs = null;
let portalCooldown = 0, portalTimer = 0, returnPos = null, pendingNetherEdits = null;
let saveTimer = 0;

// multi-world saving
const INDEX_KEY = 'skyforge_worlds';
let currentWorldId = null, currentWorldName = '';
function worldKey(id) { return 'skyforge_world_' + id; }

// storage (chests): key "dim|x,y,z" -> { itemId: count }
let chests = {};
let chestOpen = false, chestPosKey = null;

// settings (persisted)
const SETTINGS_KEY = 'skyforge_settings';
const settings = { sensitivity: 1.0, btnScale: 1.0, leftHanded: false, invertY: false };
let settingsReturn = 'menu', settingsOpen = false;

// mining (hold-to-break) state
let miningActive = false, miningTarget = null, miningProgress = 0, miningNeeded = 1;

// day/night + combat
let timeOfDay = 0.25;        // 0..1, starts at morning
let ambient = null;
let spawnTimer = 0, hurtCD = 0;
const DAY_LENGTH = 480;      // seconds for a full day–night cycle
const NIGHT_MIN = 0.12;      // darkest sky-light multiplier

function startGame() {
  // Engine (Three.js) must be loaded by the CDN bridge first.
  if (typeof THREE === 'undefined' || !window.THREE) {
    document.getElementById('cdn-error').classList.remove('hidden');
    return;
  }
  // start a brand-new world (its own save slot)
  const nameStr = ($('world-name') ? $('world-name').value.trim() : '');
  currentWorldName = nameStr || ('World ' + (readIndex().length + 1));
  currentWorldId = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  chests = {};

  menuEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  const seedStr = $('seed-input').value.trim() || ('sf' + Math.floor(Math.random() * 1e9));
  const seed = hashSeed(seedStr);

  // let the loading frame paint before heavy work
  setTimeout(() => initWorld(seed), 30);
}

function ensureNether() {
  if (netherWorld) return;
  netherWorld = new World(scene, (gameSeed ^ 0x9e3779b9) >>> 0, 'nether');
  if (isTouch) netherWorld.renderDistance = 3;
  netherMobs = new MobManager(netherWorld, scene);
  if (pendingNetherEdits) { netherWorld.loadEdits(pendingNetherEdits); pendingNetherEdits = null; }
}

function initWorld(seed, save) {
  if (!renderer) setupRenderer();

  // reset scene contents (both dimensions)
  if (overworld) overworld.hide();
  if (netherWorld) netherWorld.hide();
  if (overworldMobs) overworldMobs.clear();
  if (netherMobs) netherMobs.clear();
  netherWorld = null; netherMobs = null;
  portalCooldown = 0; portalTimer = 0;

  if (save) { selectedMode = save.mode; selectedWorld = save.type; }
  dimension = 'overworld';
  returnPos = save && save.returnPos ? save.returnPos : null;
  pendingNetherEdits = save && save.netherEdits && save.netherEdits.length ? save.netherEdits : null;

  scene.clear();
  gameSeed = save ? (save.seed >>> 0) : (seed >>> 0);
  addLights();

  world = new World(scene, gameSeed, selectedWorld);
  overworld = world;
  if (isTouch) world.renderDistance = 3;   // lighter for mobile
  if (save) overworld.loadEdits(save.overworldEdits);

  // spawn position
  let sx = 0.5, sz = 0.5;
  if (selectedWorld === 'skyblock') { sx = 8.5; sz = 8.5; }
  player = new Player(camera, world);
  player.setMode(selectedMode === 'creative');

  // reset survival + inventory
  health = 20; hunger = 20; lavaTimer = 0;
  miningActive = false; miningTarget = null; miningProgress = 0;
  furnaceOpen = false; $('furnace').classList.add('hidden');
  chestOpen = false; $('chest').classList.add('hidden');
  timeOfDay = save ? save.timeOfDay : 0.25; spawnTimer = 0; hurtCD = 0;
  crops = save && save.crops ? save.crops : [];
  saplings = save && save.saplings ? save.saplings : [];
  cropTimer = 0; saplingTimer = 0;
  buildItemIcons();
  setupInventory();
  buildCrafting();

  if (save) {
    // restore player + survival state
    player.pos.set(save.player.x, save.player.y, save.player.z);
    player.yaw = save.player.yaw; player.pitch = save.player.pitch;
    health = save.player.health; hunger = save.player.hunger;
    if (selectedMode === 'survival' && save.inv) {
      for (const k in inventory) delete inventory[k];
      for (const k in save.inv) inventory[+k] = save.inv[k];
    }
    Object.assign(equippedArmor, save.armor || {});
    refreshHotbar(true);
    if (save.activeItem != null) selectHotbarItem(save.activeItem);
    // restore the dimension we saved in
    if (save.dimension === 'nether') {
      ensureNether();
      world = netherWorld; mobs = netherMobs; dimension = 'nether'; player.world = world;
      world.preload(player.pos.x, player.pos.z);
    } else {
      world.preload(player.pos.x, player.pos.z);
    }
  } else {
    world.preload(sx, sz);                                   // generate terrain first
    const sy = world.surfaceY(Math.floor(sx), Math.floor(sz));
    player.pos.set(sx, sy + 1, sz);
    // skyblock: give a starter chest on the island
    if (selectedWorld === 'skyblock') addSkyblockChest();
  }

  // safety: never start embedded in terrain (rescues old under-map saves too)
  {
    const fx = Math.floor(player.pos.x), fz = Math.floor(player.pos.z);
    if (world.isSolid(fx, Math.floor(player.pos.y), fz) || world.isSolid(fx, Math.floor(player.pos.y) + 1, fz)) {
      const fy = dimension === 'nether' ? world.floorY(fx, fz, 40) : world.surfaceY(fx, fz);
      player.pos.set(fx + 0.5, fy + 0.1, fz + 0.5);
      player.vel.set(0, 0, 0);
    }
  }

  if (dimension === 'nether') { mobs = netherMobs; }
  else {
    mobs = new MobManager(world, scene);
    overworldMobs = mobs;
    if (selectedWorld !== 'skyblock') mobs.spawnInitial(player.pos.x, player.pos.z, isTouch ? 5 : 8, 16);
    else mobs.spawnInitial(player.pos.x, player.pos.z, 3, 3);
  }
  if (!overworldMobs) { overworldMobs = new MobManager(overworld, scene); }

  updateStats();

  loadingEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' +
    (dimension === 'nether' ? 'nether' : selectedWorld);
  $('stats').style.display = selectedMode === 'survival' ? 'flex' : 'none';
  setDimensionVisuals();

  if (isTouch) {
    touchEl.classList.remove('hidden');
    const h = $('touch-hint');
    h.classList.remove('hidden'); h.style.opacity = '1';
    setTimeout(hideHint, 6000);
  }

  drainLootChests();   // register loot for structures in the spawn area

  running = true; paused = false;
  lastTime = performance.now(); saveTimer = 0;
  requestAnimationFrame(loop);
  saveGame();   // persist immediately so "Continue" reflects this world
}

// ---------------- three setup ----------------
function setupRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1000);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  setupInput();
}

function addLights() {
  ambient = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambient);
  sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);
  setDimensionVisuals();
}

// 0..1 brightness of the sky right now (1 = noon, NIGHT_MIN = midnight)
function skyBrightness() {
  const raw = 0.5 + 0.5 * Math.cos((timeOfDay - 0.25) * Math.PI * 2);
  return NIGHT_MIN + (1 - NIGHT_MIN) * Math.max(0, Math.min(1, (raw - 0.1) / 0.5));
}
function isNight() { return (0.5 + 0.5 * Math.cos((timeOfDay - 0.25) * Math.PI * 2)) < 0.22; }

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
}

function updateDayNight(dt) {
  timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
  if (dimension === 'nether') { world.dayUniform.value = 1.0; return; }
  const b = skyBrightness();
  world.dayUniform.value = b;
  ambient.intensity = 0.35 + 0.45 * b;
  sun.intensity = 0.15 + 0.6 * b;
  // sky + fog colour: night -> day
  const t = Math.max(0, Math.min(1, (b - NIGHT_MIN) / (1 - NIGHT_MIN)));
  const col = lerpColor(0x070b16, 0x8fc7ee, t);
  scene.background.setHex(col);
  if (scene.fog) scene.fog.color.setHex(col);
  // sun rises/sets across the sky
  const ang = timeOfDay * Math.PI * 2;
  sun.position.set(Math.cos(ang), Math.max(0.15, Math.sin(ang)), 0.3);
  updateDayIcon(b);
}
function updateDayIcon(b) {
  const el = $('daynight');
  if (el) el.textContent = isNight() ? '🌙' : (b > 0.8 ? '☀️' : '🌅');
}

// Sky colour + fog depend on the current dimension.
function setDimensionVisuals() {
  if (dimension === 'nether') {
    scene.background = new THREE.Color(0x2a0d0d);
    scene.fog = new THREE.Fog(0x2a0d0d, CHUNK * 1.4, CHUNK * (isTouch ? 2.6 : 3.4));
  } else {
    scene.background = new THREE.Color(0x8fc7ee);
    scene.fog = new THREE.Fog(0x8fc7ee, CHUNK * 2.5, CHUNK * (isTouch ? 3.2 : 4.2));
  }
}

// ---------------- inventory + items ----------------
const inventory = {};        // itemId -> count (Infinity in creative)
let hotbarItems = [];        // itemIds shown on the hotbar

const ALL_TOOLS = [ITEM.W_PICK, ITEM.W_AXE, ITEM.W_SHOVEL, ITEM.W_SWORD, ITEM.W_HOE,
                   ITEM.S_PICK, ITEM.S_AXE, ITEM.S_SHOVEL, ITEM.S_SWORD, ITEM.S_HOE,
                   ITEM.I_PICK, ITEM.I_AXE, ITEM.I_SHOVEL, ITEM.I_SWORD, ITEM.I_HOE,
                   ITEM.D_PICK, ITEM.D_AXE, ITEM.D_SHOVEL, ITEM.D_SWORD];
// extra non-block items shown in creative
const CREATIVE_EXTRA = [ITEM.WHEAT_SEEDS, BLOCK.SAPLING, ITEM.BREAD,
  ITEM.L_HELM, ITEM.L_CHEST, ITEM.L_LEGS, ITEM.L_BOOTS,
  ITEM.I_HELM, ITEM.I_CHEST, ITEM.I_LEGS, ITEM.I_BOOTS];
let furnaceOpen = false;

// armor + farming state
const equippedArmor = { helmet: 0, chest: 0, legs: 0, boots: 0 };
let crops = [], cropTimer = 0;
let saplings = [], saplingTimer = 0;

function iconStyle(id) {
  const icon = itemIcon(id);
  const fallback = isBlockItem(id) && BLOCK_INFO[id] ? BLOCK_INFO[id].color : '#3a3f4b';
  const bg = icon ? `background-image:url('${icon}');background-size:cover;` : '';
  return `${bg}background-color:${fallback};`;
}

function setupInventory() {
  for (const k in inventory) delete inventory[k];
  equippedArmor.helmet = equippedArmor.chest = equippedArmor.legs = equippedArmor.boots = 0;
  if (selectedMode === 'creative') {
    for (const id of PALETTE) inventory[id] = Infinity;
    for (const id of ALL_TOOLS) inventory[id] = Infinity;
    for (const id of CREATIVE_EXTRA) inventory[id] = Infinity;
  }
  // survival starts with an empty inventory — punch a tree to begin
  refreshHotbar(true);
}

// give / take items
function give(id, n) {
  if (inventory[id] === Infinity) return;
  inventory[id] = (inventory[id] || 0) + n;
  refreshHotbar();
}
function take(id, n) {
  if (inventory[id] === Infinity) return;
  inventory[id] = (inventory[id] || 0) - n;
  if (inventory[id] <= 0) delete inventory[id];
  refreshHotbar();
}
function activeItem() { return hotbarItems[hotbarIndex]; }
function activeTool() { const it = activeItem(); return TOOLS[it] ? it : 0; }

// recompute the hotbar contents, preserving the selected item where possible
function refreshHotbar(reset) {
  const prev = reset ? null : hotbarItems[hotbarIndex];
  if (selectedMode === 'creative') {
    hotbarItems = [...ALL_TOOLS, ...PALETTE, ...CREATIVE_EXTRA];
  } else {
    const owned = Object.keys(inventory).map(Number).filter((id) => (inventory[id] || 0) > 0);
    owned.sort((a, b) => (isTool(b) - isTool(a)) || (a - b));  // tools first
    hotbarItems = owned;
  }
  if (hotbarItems.length === 0) { hotbarItems = []; hotbarIndex = 0; buildHotbarDOM(); if (paused) { buildInventory(); refreshCrafting(); } return; }
  let idx = prev != null ? hotbarItems.indexOf(prev) : -1;
  hotbarIndex = idx >= 0 ? idx : Math.max(0, Math.min(hotbarIndex, hotbarItems.length - 1));
  buildHotbarDOM();
  if (paused) { buildInventory(); refreshCrafting(); }
}

function buildHotbarDOM() {
  const hb = $('hotbar');
  hb.innerHTML = '';
  hotbarItems.forEach((id, i) => {
    const c = inventory[id];
    const count = (c === Infinity || c == null || isTool(id)) ? '' : (c > 0 ? c : '');
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === hotbarIndex ? ' active' : '');
    slot.innerHTML =
      `<span class="name">${itemName(id)}</span>` +
      `<div class="swatch" style="${iconStyle(id)}"></div>` +
      `<span class="count">${count}</span>`;
    slot.addEventListener('click', () => selectHotbar(i));
    hb.appendChild(slot);
  });
  const s = hb.children[hotbarIndex];
  if (s) hb.scrollLeft = s.offsetLeft - hb.clientWidth / 2 + s.clientWidth / 2;
}

function selectHotbar(i) {
  if (!hotbarItems.length) return;
  hotbarIndex = (i + hotbarItems.length) % hotbarItems.length;
  buildHotbarDOM();
}

// ---- inventory + crafting panel (pause screen) ----
function buildInventory() {
  buildArmorSlots();
  const grid = $('inventory-grid');
  grid.innerHTML = '';
  const ids = selectedMode === 'creative'
    ? [...ALL_TOOLS, ...PALETTE, ...CREATIVE_EXTRA]
    : Object.keys(inventory).map(Number).filter((id) => (inventory[id] || 0) > 0);
  if (ids.length === 0) { grid.innerHTML = '<p class="empty">Mine some blocks…</p>'; }
  ids.forEach((id) => {
    const c = inventory[id];
    const count = (c === Infinity || isTool(id)) ? '' : c;
    const it = document.createElement('div');
    it.className = 'inv-item';
    it.innerHTML = `<div class="swatch" style="${iconStyle(id)}"></div>` +
      `<span class="count">${count || ''}</span><span class="lbl">${itemName(id)}</span>`;
    it.addEventListener('click', () => {
      if (isArmor(id)) { equipArmor(id); }
      else { selectHotbarItem(id); togglePause(); }
    });
    grid.appendChild(it);
  });
}
function selectHotbarItem(id) {
  const i = hotbarItems.indexOf(id);
  if (i >= 0) selectHotbar(i);
}

// ---- armor ----
const ARMOR_SLOTS = ['helmet', 'chest', 'legs', 'boots'];
function armorPoints() {
  let p = 0;
  for (const s of ARMOR_SLOTS) { const id = equippedArmor[s]; if (id && ARMOR[id]) p += ARMOR[id].points; }
  return p;
}
function reduceDamage(d) {
  const factor = 1 - Math.min(0.8, armorPoints() * 0.04);
  return Math.max(0, Math.round(d * factor));
}
function equipArmor(id) {
  const slot = ARMOR[id].slot;
  if ((inventory[id] || 0) <= 0) return;
  const old = equippedArmor[slot];
  take(id, 1);
  if (old) give(old, 1);
  equippedArmor[slot] = id;
  buildInventory();
  flash('Equipped ' + itemName(id));
}
function unequipArmor(slot) {
  const id = equippedArmor[slot];
  if (!id) return;
  equippedArmor[slot] = 0;
  give(id, 1);
  buildInventory();
}
function buildArmorSlots() {
  const row = $('armor-row');
  if (!row) return;
  row.innerHTML = '';
  for (const slot of ARMOR_SLOTS) {
    const id = equippedArmor[slot];
    const cell = document.createElement('div');
    cell.className = 'armor-slot' + (id ? ' filled' : '');
    cell.title = slot;
    cell.innerHTML = id
      ? `<div class="swatch" style="${iconStyle(id)}"></div>`
      : `<span class="armor-ph">${slot[0].toUpperCase()}</span>`;
    cell.addEventListener('click', () => unequipArmor(slot));
    row.appendChild(cell);
  }
  const pts = $('armor-points');
  if (pts) pts.textContent = armorPoints() ? '🛡️ ' + armorPoints() : '';
}

function buildCrafting() {
  const list = $('crafting-list');
  list.innerHTML = '';
  RECIPES.forEach((r, ri) => {
    const row = document.createElement('div');
    row.className = 'recipe';
    row.dataset.ri = ri;
    const ing = r.in.map(([id, n]) =>
      `<span class="ing"><span class="swatch sm" style="${iconStyle(id)}"></span>${n}</span>`).join('');
    row.innerHTML =
      `<div class="recipe-out"><span class="swatch" style="${iconStyle(r.out)}"></span>` +
      `<span class="recipe-name">${itemName(r.out)}${r.n > 1 ? ' ×' + r.n : ''}</span></div>` +
      `<div class="recipe-ings">${ing}</div>` +
      `<button class="craft-btn">Craft</button>`;
    row.querySelector('.craft-btn').addEventListener('click', () => craft(r));
    list.appendChild(row);
  });
  refreshCrafting();
}
function refreshCrafting() {
  document.querySelectorAll('#crafting-list .recipe').forEach((row) => {
    const r = RECIPES[+row.dataset.ri];
    const ok = canCraft(inventory, r);
    row.classList.toggle('disabled', !ok);
    row.querySelector('.craft-btn').disabled = !ok;
  });
}
function craft(r) {
  if (!canCraft(inventory, r)) return;
  for (const [id, n] of r.in) take(id, n);
  give(r.out, r.n);
  refreshHotbar();
  buildInventory();
  refreshCrafting();
  flash('Crafted ' + itemName(r.out));
}

// ---- furnace / smelting ----
function buildFurnace() {
  const list = $('furnace-list');
  list.innerHTML = '';
  SMELTS.forEach((s, si) => {
    const row = document.createElement('div');
    row.className = 'recipe'; row.dataset.si = si;
    row.innerHTML =
      `<div class="recipe-out"><span class="swatch" style="${iconStyle(s.out)}"></span>` +
      `<span class="recipe-name">${itemName(s.out)}</span></div>` +
      `<div class="recipe-ings">` +
        `<span class="ing"><span class="swatch sm" style="${iconStyle(s.in)}"></span>1</span>` +
        `<span class="ing">🔥&nbsp;fuel</span></div>` +
      `<button class="craft-btn">Smelt</button>`;
    row.querySelector('.craft-btn').addEventListener('click', () => smelt(s));
    list.appendChild(row);
  });
  refreshFurnace();
}
function refreshFurnace() {
  document.querySelectorAll('#furnace-list .recipe').forEach((row) => {
    const s = SMELTS[+row.dataset.si];
    const ok = canSmelt(inventory, s);
    row.classList.toggle('disabled', !ok);
    row.querySelector('.craft-btn').disabled = !ok;
  });
}
function smelt(s) {
  if (!canSmelt(inventory, s)) return;
  take(s.in, 1);
  const fuel = fuelInInv(inventory);
  if (fuel != null) take(fuel, 1);
  give(s.out, 1);
  refreshHotbar();
  refreshFurnace();
  flash('Smelted ' + itemName(s.out));
}
function openFurnace() {
  if (!running) return;
  furnaceOpen = true;
  onBreakRelease();
  buildFurnace();
  $('furnace').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeFurnace() {
  furnaceOpen = false;
  $('furnace').classList.add('hidden');
  lastTime = performance.now();
}

function updateStats() {
  if (selectedMode !== 'survival') return;
  const hp = $('health'), hg = $('hunger');
  const hearts = Math.round(health / 2), drum = Math.round(hunger / 2);
  hp.innerHTML = ''; hg.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const a = document.createElement('span'); a.className = 'pip';
    a.textContent = i < hearts ? '❤️' : '🖤'; hp.appendChild(a);
  }
  for (let i = 0; i < 10; i++) {
    const a = document.createElement('span'); a.className = 'pip';
    a.textContent = i < drum ? '🍗' : '·'; hg.appendChild(a);
  }
}

// ---------------- input ----------------
const keys = {};
function setupInput() {
  // ----- keyboard -----
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Escape') { if (settingsOpen) closeSettings(); else if (furnaceOpen) closeFurnace(); else if (chestOpen) closeChest(); else togglePause(); }
    if (e.code === 'KeyE') { if (settingsOpen) closeSettings(); else if (furnaceOpen) closeFurnace(); else if (chestOpen) closeChest(); else togglePause(); }  // inventory
    if (e.code === 'KeyF') player && player.toggleFly();
    if (e.code === 'KeyG') ignitePortal();
    if (e.code.startsWith('Digit')) {
      const n = +e.code.slice(5);
      if (n >= 1 && n <= hotbarItems.length) selectHotbar(n - 1);
    }
    if (e.code === 'Space') {
      const now = performance.now();
      if (now - lastSpace < 280 && player) player.toggleFly();
      lastSpace = now;
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // ----- mouse look (pointer lock) -----
  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => {
    if (!isTouch && running && !paused && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas && player && !paused) {
      player.look(e.movementX * settings.sensitivity, e.movementY * settings.sensitivity * (settings.invertY ? -1 : 1));
    }
  });
  // desktop break (hold) / place
  canvas.addEventListener('mousedown', (e) => {
    if (isTouch || !running || paused) return;
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) onBreakPress();
    else if (e.button === 2) placeBlock();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) onBreakRelease(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // scroll hotbar
  window.addEventListener('wheel', (e) => {
    if (!running || paused) return;
    selectHotbar(hotbarIndex + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  // ----- buttons -----
  $('menu-btn').addEventListener('click', togglePause);
  $('inv-btn').addEventListener('click', togglePause);
  $('resume-btn').addEventListener('click', togglePause);
  $('quit-btn').addEventListener('click', quitToMenu);
  $('furnace-close').addEventListener('click', closeFurnace);

  if (isTouch) setupTouch();
}
let lastSpace = 0;

function readKeyboard() {
  let mz = 0, mx = 0;
  if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  input.mx = mx; input.mz = mz;
  input.jump = !!keys['Space'];
  input.sprint = !!(keys['ControlLeft'] || keys['KeyR']);  // sprint via Ctrl / R
  input.up = !!keys['Space'];
  input.down = !!(keys['ShiftLeft'] || keys['ShiftRight']); // descend while flying
}

// ----- touch controls -----
// Left half of the screen = a dynamic thumbstick that appears wherever you
// press (up on the stick = forward, relative to the camera). Right half =
// drag to look. Action buttons handle themselves.
function setupTouch() {
  const joy = $('joystick'), knob = $('joystick-knob');
  const DEAD = 0.2, LOOK_SENS = 0.9;
  const Rad = () => 55 * settings.btnScale;   // joystick radius tracks button size

  let moveId = null, moveOX = 0, moveOY = 0;
  let lookId = null, lastLX = 0, lastLY = 0;

  const showJoy = (x, y) => {
    joy.style.left = x + 'px'; joy.style.top = y + 'px';
    joy.classList.add('active');
    knob.style.transform = 'translate(0,0)';
  };
  const updateJoy = (x, y) => {
    const R = Rad();
    let dx = x - moveOX, dy = y - moveOY;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mx = dx / R, mz = dy / R;
    if (Math.hypot(mx, mz) < DEAD) { input.mx = 0; input.mz = 0; }
    else { input.mx = mx; input.mz = mz; }
    input.sprint = d > R * 0.9;
  };
  const endJoy = () => {
    moveId = null; joy.classList.remove('active');
    input.mx = 0; input.mz = 0; input.sprint = false;
  };

  window.addEventListener('touchstart', (e) => {
    if (!running || paused || furnaceOpen || chestOpen || settingsOpen) return;
    hideHint();
    for (const t of e.changedTouches) {
      if (isOnButton(t)) continue;                         // buttons/hotbar self-handle
      const half = window.innerWidth * 0.5;
      const onMoveSide = settings.leftHanded ? (t.clientX > half) : (t.clientX < half);
      if (moveId === null && onMoveSide) {
        moveId = t.identifier; moveOX = t.clientX; moveOY = t.clientY;
        showJoy(t.clientX, t.clientY); updateJoy(t.clientX, t.clientY);
        e.preventDefault();
      } else if (lookId === null) {
        lookId = t.identifier; lastLX = t.clientX; lastLY = t.clientY;
      }
    }
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!running || paused || furnaceOpen || chestOpen || settingsOpen) return;
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { e.preventDefault(); updateJoy(t.clientX, t.clientY); }
      else if (t.identifier === lookId && player) {
        e.preventDefault();
        const s = LOOK_SENS * settings.sensitivity;
        player.look((t.clientX - lastLX) * s, (t.clientY - lastLY) * s * (settings.invertY ? -1 : 1));
        lastLX = t.clientX; lastLY = t.clientY;
      }
    }
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) endJoy();
      if (t.identifier === lookId) lookId = null;
    }
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);

  // action buttons
  const jump = $('btn-jump');
  jump.addEventListener('touchstart', (e) => { e.preventDefault(); input.jump = true; input.up = true; }, { passive: false });
  jump.addEventListener('touchend', (e) => { e.preventDefault(); input.jump = false; input.up = false; }, { passive: false });
  // long-press jump toggles fly in creative
  let jumpHold = null;
  jump.addEventListener('touchstart', () => { jumpHold = setTimeout(() => player && player.toggleFly(), 500); });
  jump.addEventListener('touchend', () => clearTimeout(jumpHold));

  $('btn-place').addEventListener('touchstart', (e) => { e.preventDefault(); placeBlock(); }, { passive: false });
  $('btn-break').addEventListener('touchstart', (e) => { e.preventDefault(); onBreakPress(); }, { passive: false });
  $('btn-break').addEventListener('touchend', (e) => { e.preventDefault(); onBreakRelease(); }, { passive: false });
  $('btn-ignite').addEventListener('touchstart', (e) => { e.preventDefault(); ignitePortal(); }, { passive: false });
}
function hideHint() {
  const h = $('touch-hint');
  if (h && !h.classList.contains('hidden')) {
    h.style.opacity = '0';
    setTimeout(() => h.classList.add('hidden'), 400);
  }
}
function isOnButton(t) {
  const el = document.elementFromPoint(t.clientX, t.clientY);
  return el && (el.classList.contains('touch-btn') || el.closest('#hotbar') || el.closest('#top-controls'));
}

// ---------------- voxel raycast (Amanatides & Woo) ----------------
function raycast(maxDist = 6) {
  const origin = player.getEyePos();
  const dir = player.getDirection();
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const fr = (v, s) => s > 0 ? (Math.ceil(v) - v) : (v - Math.floor(v));
  let tMaxX = dir.x !== 0 ? fr(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? fr(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? fr(origin.z, stepZ) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  while (t <= maxDist) {
    const b = world.getBlock(x, y, z);
    const bi = BLOCK_INFO[b];
    if (b !== BLOCK.AIR && bi && (bi.solid || bi.crop)) {
      return { x, y, z, nx, ny, nz, block: b };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

// ---- mining ----
function onBreakPress() {
  if (!running || paused || furnaceOpen || chestOpen || settingsOpen) return;
  // melee first if we're aiming at a mob
  const t = TOOLS[activeItem()];
  const dmg = (t && t.attack) || 1;
  const drops = mobs.attack(player.getEyePos(), player.getDirection(), 3.2, dmg);
  if (drops) { if (selectedMode === 'survival') for (const d of drops) give(d.id, d.n); return; }
  if (selectedMode === 'creative') { mineInstant(); return; }
  miningActive = true;            // survival: hold to break (handled in loop)
}
function onBreakRelease() {
  miningActive = false; miningTarget = null; miningProgress = 0;
  showMining(-1);
}
function mineInstant() {
  const hit = raycast();
  if (!hit || BLOCK_INFO[hit.block].unbreakable) return;
  world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
  if (hit.block === BLOCK.SAPLING) removeSapling(hit.x, hit.y, hit.z);
  else if (BLOCK_INFO[hit.block].crop) removeCrop(hit.x, hit.y, hit.z);
  if (hit.block === BLOCK.CHEST) dumpChest(hit.x, hit.y, hit.z);
}
function doBreakSurvival(hit) {
  if (BLOCK_INFO[hit.block].unbreakable) return;
  const tool = activeTool();
  world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
  if (hit.block === BLOCK.SAPLING) { removeSapling(hit.x, hit.y, hit.z); give(BLOCK.SAPLING, 1); return; }
  if (BLOCK_INFO[hit.block].crop) { harvestCrop(hit.block, hit.x, hit.y, hit.z); return; }
  if (hit.block === BLOCK.CHEST) dumpChest(hit.x, hit.y, hit.z);
  const drop = blockDrop(hit.block, tool);
  if (drop) give(drop.id, drop.n);
  // grass occasionally yields wheat seeds; leaves occasionally yield a sapling
  if (hit.block === BLOCK.GRASS && Math.random() < 0.2) give(ITEM.WHEAT_SEEDS, 1);
  if (hit.block === BLOCK.LEAVES && Math.random() < 0.1) give(BLOCK.SAPLING, 1);
}

// place a block OR use the held item (eat / till / plant)
function placeBlock() {
  if (!running || paused || furnaceOpen || chestOpen || settingsOpen) return;
  const item = activeItem();
  if (isFood(item)) { eatFood(item); return; }   // food needs no target
  const hit = raycast();
  if (!hit) return;
  // interact with stations
  if (hit.block === BLOCK.FURNACE) { openFurnace(); return; }
  if (hit.block === BLOCK.CHEST) { openChest(hit.x, hit.y, hit.z); return; }
  if (hit.block === BLOCK.CRAFTING_TABLE) { togglePause(); return; }
  // hoe: till grass/dirt into farmland
  const tool = TOOLS[item];
  if (tool && tool.type === 'hoe') {
    if ((hit.block === BLOCK.GRASS || hit.block === BLOCK.DIRT) &&
        world.getBlock(hit.x, hit.y + 1, hit.z) === BLOCK.AIR) {
      world.setBlock(hit.x, hit.y, hit.z, BLOCK.FARMLAND); flash('Tilled soil');
    }
    return;
  }
  // sapling: plant on grass/dirt, grows into a tree
  if (item === BLOCK.SAPLING) {
    if ((hit.block === BLOCK.GRASS || hit.block === BLOCK.DIRT) &&
        world.getBlock(hit.x, hit.y + 1, hit.z) === BLOCK.AIR) {
      world.setBlock(hit.x, hit.y + 1, hit.z, BLOCK.SAPLING);
      saplings.push({ x: hit.x, y: hit.y + 1, z: hit.z });
      if (selectedMode === 'survival') take(BLOCK.SAPLING, 1);
      flash('Planted sapling');
    }
    return;
  }
  // seeds: plant on farmland
  if (item === ITEM.WHEAT_SEEDS) {
    if (hit.block === BLOCK.FARMLAND && world.getBlock(hit.x, hit.y + 1, hit.z) === BLOCK.AIR) {
      world.setBlock(hit.x, hit.y + 1, hit.z, BLOCK.WHEAT0);
      crops.push({ x: hit.x, y: hit.y + 1, z: hit.z, stage: 0 });
      if (selectedMode === 'survival') take(ITEM.WHEAT_SEEDS, 1);
      flash('Planted wheat');
    }
    return;
  }
  // otherwise place a block
  if (!isBlockItem(item) || !PALETTE.includes(item)) return;
  if (selectedMode === 'survival' && !(inventory[item] > 0)) return;
  const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
  let id = item;
  if (item === BLOCK.WOOD) {
    if (hit.nx !== 0) id = BLOCK.WOOD_X;
    else if (hit.nz !== 0) id = BLOCK.WOOD_Z;
  }
  if (overlapsPlayer(px, py, pz)) return;
  if (world.getBlock(px, py, pz) !== BLOCK.AIR) return;
  world.setBlock(px, py, pz, id);
  if (selectedMode === 'survival') take(item, 1);
}

// ---- farming helpers ----
function removeCrop(x, y, z) { crops = crops.filter((c) => !(c.x === x && c.y === y && c.z === z)); }
function harvestCrop(block, x, y, z) {
  removeCrop(x, y, z);
  give(ITEM.WHEAT_SEEDS, 1);
  if (block === BLOCK.WHEAT2) give(ITEM.WHEAT, 1 + (Math.random() < 0.5 ? 1 : 0));
}
function eatFood(item) {
  if (selectedMode !== 'survival') { flash('No need to eat in creative'); return; }
  if (hunger >= 20 && health >= 20) { flash('Already full'); return; }
  const f = FOOD[item];
  hunger = Math.min(20, hunger + f.hunger);
  if (f.heal) health = Math.min(20, health + f.heal);
  take(item, 1); updateStats(); flash('Ate ' + itemName(item));
}
function removeSapling(x, y, z) { saplings = saplings.filter((s) => !(s.x === x && s.y === y && s.z === z)); }
function growSaplings(dt) {
  if (saplings.length === 0) return;
  saplingTimer += dt;
  if (saplingTimer < 5) return;
  saplingTimer = 0;
  for (const s of saplings.slice()) {
    if (Math.random() < 0.25) {
      if (world.getBlock(s.x, s.y, s.z) !== BLOCK.SAPLING) { removeSapling(s.x, s.y, s.z); continue; }
      // needs a couple of blocks of headroom to grow
      if (world.getBlock(s.x, s.y + 1, s.z) !== BLOCK.AIR) continue;
      removeSapling(s.x, s.y, s.z);
      world.placeTree(s.x, s.y, s.z);
    }
  }
}
function growCrops(dt) {
  if (dimension !== 'overworld' || crops.length === 0) return;
  cropTimer += dt;
  if (cropTimer < 2.5) return;
  cropTimer = 0;
  for (const c of crops) {
    if (c.stage >= 2) continue;
    if (Math.random() < 0.3) {
      const cur = world.getBlock(c.x, c.y, c.z);
      if (cur < BLOCK.WHEAT0 || cur > BLOCK.WHEAT2) continue;   // got removed
      c.stage++;
      world.setBlock(c.x, c.y, c.z, c.stage === 1 ? BLOCK.WHEAT1 : BLOCK.WHEAT2);
    }
  }
}

// mining progress bar near the crosshair (frac < 0 hides it)
function showMining(frac) {
  const bar = $('mining-bar'), fill = $('mining-fill');
  if (!bar) return;
  if (frac < 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  fill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
}

function overlapsPlayer(bx, by, bz) {
  const p = player.pos;
  const minX = p.x - 0.3, maxX = p.x + 0.3, minZ = p.z - 0.3, maxZ = p.z + 0.3;
  const minY = p.y, maxY = p.y + 1.8;
  return bx + 1 > minX && bx < maxX && bz + 1 > minZ && bz < maxZ && by + 1 > minY && by < maxY;
}

// ---------------- nether portal ----------------
// Detect a rectangular air area enclosed by obsidian, in a vertical plane.
function findPortalArea(w, ix, iy, iz) {
  if (w.getBlock(ix, iy, iz) !== BLOCK.AIR) return null;
  for (const plane of ['z', 'x']) {
    const fixed = plane === 'z' ? iz : ix;
    const a0 = plane === 'z' ? ix : iz;
    const get = (a, b) => plane === 'z' ? w.getBlock(a, b, fixed) : w.getBlock(fixed, b, a);

    // bounded scans — never run past the max portal size (prevents hangs when
    // a plane is open air with no enclosing obsidian)
    const LIM = 23;
    let left = a0, n = 0; while (get(left - 1, iy) === BLOCK.AIR && n++ < LIM) left--;
    let right = a0; n = 0; while (get(right + 1, iy) === BLOCK.AIR && n++ < LIM) right++;
    let bot = iy; n = 0; while (get(a0, bot - 1) === BLOCK.AIR && n++ < LIM) bot--;
    let top = iy; n = 0; while (get(a0, top + 1) === BLOCK.AIR && n++ < LIM) top++;
    const width = right - left + 1, height = top - bot + 1;
    if (width < 2 || width > 21 || height < 3 || height > 21) continue;

    let ok = true;
    for (let a = left; a <= right && ok; a++)
      for (let b = bot; b <= top; b++)
        if (get(a, b) !== BLOCK.AIR) ok = false;
    for (let b = bot; b <= top && ok; b++)
      if (get(left - 1, b) !== BLOCK.OBSIDIAN || get(right + 1, b) !== BLOCK.OBSIDIAN) ok = false;
    for (let a = left; a <= right && ok; a++)
      if (get(a, bot - 1) !== BLOCK.OBSIDIAN || get(a, top + 1) !== BLOCK.OBSIDIAN) ok = false;
    if (!ok) continue;

    const cells = [];
    for (let a = left; a <= right; a++)
      for (let b = bot; b <= top; b++)
        cells.push(plane === 'z' ? [a, b, fixed] : [fixed, b, a]);
    return {
      cells,
      minX: plane === 'z' ? left : fixed, maxX: plane === 'z' ? right : fixed,
      minZ: plane === 'z' ? fixed : left, maxZ: plane === 'z' ? fixed : right,
    };
  }
  return null;
}

function ignitePortal() {
  if (!running || paused) return;
  const hit = raycast(6);
  if (!hit || hit.block !== BLOCK.OBSIDIAN) { flash('Aim at an obsidian frame'); return; }
  const ix = hit.x + hit.nx, iy = hit.y + hit.ny, iz = hit.z + hit.nz;
  const area = findPortalArea(world, ix, iy, iz);
  if (!area) { flash('No valid portal frame'); return; }
  for (const c of area.cells) world.setBlock(c[0], c[1], c[2], BLOCK.PORTAL, false);
  world.remeshArea(area.minX, area.maxX, area.minZ, area.maxZ);
  flash('Portal lit! Step through…');
}

// Build a ready-made 4x5 obsidian portal (2x3 interior) at a destination.
function buildPortalStructure(w, bx, by, bz) {
  for (let x = bx - 1; x <= bx + 2; x++)
    for (let y = by - 1; y <= by + 3; y++) {
      const edge = (x === bx - 1 || x === bx + 2 || y === by - 1 || y === by + 3);
      if (edge) w.setBlock(x, y, bz, BLOCK.OBSIDIAN, false);
      else w.setBlock(x, y, bz, BLOCK.PORTAL, false);
    }
  // clear standing room in front of the portal
  for (let x = bx - 1; x <= bx + 2; x++)
    for (let y = by; y <= by + 2; y++)
      for (let dz = 1; dz <= 2; dz++) w.setBlock(x, y, bz + dz, BLOCK.AIR, false);
  w.remeshArea(bx - 2, bx + 3, bz - 1, bz + 3);
}

function teleport() {
  const entryX = Math.floor(player.pos.x), entryZ = Math.floor(player.pos.z);
  world.hide(); mobs.hide();

  if (dimension === 'overworld') {
    returnPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
    ensureNether();
    dimension = 'nether';
    world = netherWorld; mobs = netherMobs; player.world = world;
    const dx = Math.round(entryX / 4), dz = Math.round(entryZ / 4);
    world.preload(dx + 0.5, dz + 0.5);
    const by = world.floorY(dx, dz, 40);
    buildPortalStructure(world, dx, by, dz);
    const sy = world.floorY(dx, dz + 1, 40);
    player.pos.set(dx + 0.5, sy, dz + 1.5);   // stand in front of the portal
  } else {
    dimension = 'overworld';
    world = overworld; mobs = overworldMobs; player.world = world;
    if (returnPos) player.pos.set(returnPos.x, returnPos.y, returnPos.z);
  }

  player.vel.set(0, 0, 0);
  world.show(); mobs.show();
  setDimensionVisuals();
  portalCooldown = 2.2; portalTimer = 0;
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' +
    (dimension === 'nether' ? 'nether' : selectedWorld);
}

// transient on-screen message
let flashTimer = null;
function flash(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.opacity = '1';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.classList.add('hidden'), 350); }, 1600);
}

// ---------------- pause / quit ----------------
function togglePause() {
  if (!running) return;
  if (furnaceOpen) { closeFurnace(); return; }
  if (chestOpen) { closeChest(); return; }
  paused = !paused;
  pauseEl.classList.toggle('hidden', !paused);
  if (paused) {
    onBreakRelease();                 // stop mining while in the menu
    buildInventory(); refreshCrafting();
    saveGame();
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    lastTime = performance.now();
  }
}
function quitToMenu() {
  saveGame();
  running = false; paused = false; furnaceOpen = false; chestOpen = false;
  pauseEl.classList.add('hidden');
  $('furnace').classList.add('hidden');
  $('chest').classList.add('hidden');
  hudEl.classList.add('hidden');
  touchEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  renderWorldList();
  if (document.pointerLockElement) document.exitPointerLock();
}

// ---------------- multi-world save / load ----------------
function readIndex() { try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; } catch (e) { return []; } }
function writeIndex(arr) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(arr)); } catch (e) {} }

function saveGame() {
  if (!running || !player || !currentWorldId) return false;
  try {
    const data = {
      v: 2, id: currentWorldId, name: currentWorldName,
      seed: gameSeed, type: selectedWorld, mode: selectedMode,
      dimension, timeOfDay,
      player: {
        x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch, health, hunger,
      },
      inv: selectedMode === 'survival' ? { ...inventory } : null,
      armor: { ...equippedArmor },
      activeItem: hotbarItems[hotbarIndex],
      crops, saplings, chests, returnPos,
      overworldEdits: overworld ? overworld.serializeEdits() : [],
      netherEdits: netherWorld ? netherWorld.serializeEdits() : (pendingNetherEdits || []),
    };
    localStorage.setItem(worldKey(currentWorldId), JSON.stringify(data));
    // upsert index entry
    const idx = readIndex().filter((w) => w.id !== currentWorldId);
    idx.unshift({ id: currentWorldId, name: currentWorldName, mode: selectedMode, type: selectedWorld, updated: Date.now() });
    writeIndex(idx);
    return true;
  } catch (e) { return false; }
}

function loadWorld(id) {
  let data;
  try { data = JSON.parse(localStorage.getItem(worldKey(id))); } catch (e) { return; }
  if (!data) return;
  if (typeof THREE === 'undefined' || !window.THREE) { $('cdn-error').classList.remove('hidden'); return; }
  currentWorldId = id; currentWorldName = data.name || 'World';
  chests = data.chests || {};
  menuEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  setTimeout(() => initWorld(data.seed, data), 30);
}

function deleteWorld(id) {
  try { localStorage.removeItem(worldKey(id)); } catch (e) {}
  writeIndex(readIndex().filter((w) => w.id !== id));
  renderWorldList();
}

function renderWorldList() {
  const list = $('world-list');
  if (!list) return;
  const idx = readIndex().sort((a, b) => b.updated - a.updated);
  $('worlds-section').classList.toggle('hidden', idx.length === 0);
  list.innerHTML = '';
  for (const w of idx) {
    const row = document.createElement('div');
    row.className = 'world-row';
    const when = new Date(w.updated).toLocaleDateString();
    row.innerHTML =
      `<div class="world-info"><span class="world-name">${w.name || 'World'}</span>` +
      `<span class="world-meta">${w.mode} · ${w.type} · ${when}</span></div>` +
      `<button class="world-play">Play</button><button class="world-del" title="Delete">🗑</button>`;
    row.querySelector('.world-play').addEventListener('click', () => loadWorld(w.id));
    row.querySelector('.world-del').addEventListener('click', () => {
      if (confirm('Delete "' + (w.name || 'World') + '"? This cannot be undone.')) deleteWorld(w.id);
    });
    list.appendChild(row);
  }
}

// ---------------- settings ----------------
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) Object.assign(settings, s); } catch (e) {}
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
function applySettings() {
  document.documentElement.style.setProperty('--btn-scale', settings.btnScale);
  if (touchEl) touchEl.classList.toggle('left-handed', settings.leftHanded);
}
function openSettings(from) {
  settingsReturn = from;
  settingsOpen = true;
  if (from === 'menu') menuEl.classList.add('hidden');
  else if (from === 'pause') pauseEl.classList.add('hidden');
  else { onBreakRelease(); if (document.pointerLockElement) document.exitPointerLock(); }  // in-game
  $('settings').classList.remove('hidden');
  syncSettingsUI();
}
function closeSettings() {
  settingsOpen = false;
  $('settings').classList.add('hidden');
  if (settingsReturn === 'menu') menuEl.classList.remove('hidden');
  else if (settingsReturn === 'pause') pauseEl.classList.remove('hidden');
  else { lastTime = performance.now(); }   // resume the game
}
function syncSettingsUI() {
  $('set-sens').value = settings.sensitivity;
  $('set-sens-val').textContent = settings.sensitivity.toFixed(2) + '×';
  $('set-size').value = settings.btnScale;
  $('set-size-val').textContent = Math.round(settings.btnScale * 100) + '%';
  $('set-left').classList.toggle('on', settings.leftHanded);
  $('set-invy').classList.toggle('on', settings.invertY);
}

// ---------------- chests / storage ----------------
function chestKey(x, y, z) { return dimension + '|' + x + ',' + y + ',' + z; }
function openChest(x, y, z) {
  chestPosKey = chestKey(x, y, z);
  if (!chests[chestPosKey]) chests[chestPosKey] = {};
  chestOpen = true;
  onBreakRelease();
  buildChestGUI();
  $('chest').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeChest() {
  chestOpen = false; chestPosKey = null;
  $('chest').classList.add('hidden');
  lastTime = performance.now();
}
function buildChestGUI() {
  const store = chests[chestPosKey] || {};
  const cg = $('chest-grid'), ig = $('chest-inv');
  const fill = (grid, src, onClick, emptyMsg) => {
    grid.innerHTML = '';
    const ids = Object.keys(src).map(Number).filter((id) => (src[id] || 0) > 0);
    if (!ids.length) { grid.innerHTML = `<p class="empty">${emptyMsg}</p>`; return; }
    for (const id of ids) {
      const c = src[id];
      const it = document.createElement('div');
      it.className = 'inv-item';
      it.innerHTML = `<div class="swatch" style="${iconStyle(id)}"></div>` +
        `<span class="count">${c === Infinity ? '' : c}</span><span class="lbl">${itemName(id)}</span>`;
      it.addEventListener('click', () => onClick(id));
      grid.appendChild(it);
    }
  };
  // chest -> player
  fill(cg, store, (id) => {
    const n = store[id]; give(id, n === Infinity ? 1 : n); delete store[id]; buildChestGUI();
  }, 'Empty chest');
  // player -> chest (creative gives 1 at a time)
  fill(ig, inventory, (id) => {
    const have = inventory[id];
    const n = have === Infinity ? 1 : have;
    store[id] = (store[id] || 0) + n;
    if (have !== Infinity) take(id, n);
    buildChestGUI();
  }, 'Your inventory is empty');
}
function dumpChest(x, y, z) {
  const k = chestKey(x, y, z);
  const store = chests[k];
  if (store) { for (const id in store) give(+id, store[id]); delete chests[k]; }
}
// register loot for newly generated structure chests (skip player-emptied/broken ones)
function drainLootChests() {
  if (!world.lootChests.length) return;
  for (const lc of world.lootChests) {
    if (world.getBlock(lc.x, lc.y, lc.z) !== BLOCK.CHEST) continue;
    const k = chestKey(lc.x, lc.y, lc.z);
    if (!chests[k]) chests[k] = lc.items;
  }
  world.lootChests.length = 0;
}
// starter chest placed on the skyblock island
function addSkyblockChest() {
  const cx = 9, cz = 9, cy = world.surfaceY(cx, cz);
  if (world.getBlock(cx, cy, cz) !== BLOCK.AIR) return;
  world.setBlock(cx, cy, cz, BLOCK.CHEST);
  const k = chestKey(cx, cy, cz);
  chests[k] = {};
  chests[k][BLOCK.SAPLING] = 2;
  chests[k][ITEM.WHEAT_SEEDS] = 3;
  chests[k][BLOCK.DIRT] = 8;
  chests[k][BLOCK.COBBLE] = 6;
  chests[k][ITEM.BREAD] = 2;
}

// ---------------- main loop ----------------
function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (paused || furnaceOpen || chestOpen || settingsOpen) return;

  if (!isTouch) readKeyboard();

  const prevVy = player.vel.y;
  const wasGround = player.onGround;
  player.update(dt, input);

  // fall damage in survival (reduced by armor)
  if (selectedMode === 'survival' && !wasGround && player.onGround) {
    const impact = -prevVy;
    if (impact > 14) {
      health -= reduceDamage(Math.floor((impact - 14) * 1.4));
      health = Math.max(0, health);
      updateStats();
      if (health <= 0) respawn();
    }
  }

  // hunger + regen (survival, gentle)
  if (selectedMode === 'survival') {
    hungerTimer += dt;
    if (hungerTimer > 14) { hungerTimer = 0; if (hunger > 0) { hunger--; updateStats(); } }
    if (hunger > 16 && health < 20) {
      regenTimer += dt;
      if (regenTimer > 4) { regenTimer = 0; health = Math.min(20, health + 1); updateStats(); }
    }
    if (hunger <= 0) {
      regenTimer += dt;
      if (regenTimer > 4) { regenTimer = 0; health = Math.max(0, health - 1); updateStats(); if (health <= 0) respawn(); }
    }
    // lava burns
    const fb = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.2), Math.floor(player.pos.z));
    if (fb === BLOCK.LAVA) {
      lavaTimer += dt;
      if (lavaTimer > 0.5) { lavaTimer = 0; health = Math.max(0, health - 2); updateStats(); if (health <= 0) respawn(); }
    } else lavaTimer = 0;
  }

  // survival hold-to-mine
  if (selectedMode === 'survival' && miningActive) {
    const hit = raycast();
    if (hit && !BLOCK_INFO[hit.block].unbreakable) {
      const key = hit.x + ',' + hit.y + ',' + hit.z;
      if (key !== miningTarget) {
        miningTarget = key; miningProgress = 0;
        miningNeeded = miningTime(hit.block, activeTool());
      }
      miningProgress += dt;
      showMining(miningProgress / miningNeeded);
      if (miningProgress >= miningNeeded) {
        doBreakSurvival(hit);
        miningTarget = null; miningProgress = 0; showMining(-1);
      }
    } else { miningTarget = null; showMining(-1); }
  }

  // nether portal: stand in a portal block briefly to travel
  if (portalCooldown > 0) portalCooldown -= dt;
  const inPortal =
    world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z)) === BLOCK.PORTAL ||
    world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 1), Math.floor(player.pos.z)) === BLOCK.PORTAL;
  if (inPortal && portalCooldown <= 0) {
    portalTimer += dt;
    if (portalTimer > 1.0) teleport();
  } else if (!inPortal) {
    portalTimer = 0;
  }

  // day/night + lighting + crops
  updateDayNight(dt);
  growCrops(dt);
  growSaplings(dt);

  // hostile mobs spawn at night in the overworld; burn off at dawn
  if (dimension === 'overworld') {
    if (isNight()) {
      spawnTimer -= dt;
      const cap = isTouch ? 5 : 9;
      if (spawnTimer <= 0 && mobs.hostiles.length < cap) {
        mobs.spawnHostiles(player.pos.x, player.pos.z, 2);
        spawnTimer = 4 + Math.random() * 4;
      }
    } else if (mobs.hostiles.length) {
      mobs.clearHostiles();      // daylight clears the undead
    }
  }

  world.update(player.pos.x, player.pos.z);
  drainLootChests();
  const contact = mobs.update(dt, player.pos);
  hurtCD -= dt;
  if (selectedMode === 'survival' && contact > 0 && hurtCD <= 0) {
    health = Math.max(0, health - reduceDamage(contact)); updateStats(); hurtCD = 0.5;
    if (health <= 0) respawn();
  }

  // autosave periodically
  saveTimer += dt;
  if (saveTimer > 15) { saveTimer = 0; saveGame(); }

  renderer.render(scene, camera);
}

function respawn() {
  if (dimension === 'nether') {
    const sy = world.floorY(0, 0, 40);
    player.pos.set(0.5, sy, 0.5);
  } else {
    let sx = 0.5, sz = 0.5;
    if (selectedWorld === 'skyblock') { sx = 8.5; sz = 8.5; }
    const sy = world.surfaceY(Math.floor(sx), Math.floor(sz));
    player.pos.set(sx, sy + 1, sz);
  }
  player.vel.set(0, 0, 0);
  health = 20; hunger = 20; lavaTimer = 0; updateStats();
  if (mobs) mobs.clearHostiles();
}

// ---------------- bootstrap (after all declarations are initialized) ----------------
loadSettings();
applySettings();
migrateOldSave();
wireMenu();
renderWorldList();
