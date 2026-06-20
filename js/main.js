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
  // crafting result + chest close
  $('craft-result').addEventListener('click', doCraft);
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

// dimensions (overworld <-> nether / aether / end)
let gameSeed = 0, dimension = 'overworld';
let overworld = null, netherWorld = null, aetherWorld = null, endWorld = null;
let overworldMobs = null, netherMobs = null, aetherMobs = null, endMobs = null;
let portalCooldown = 0, portalTimer = 0, returnPos = null;
let pendingNetherEdits = null, pendingAetherEdits = null, pendingEndEdits = null;
let endDragonDefeated = false, endFightWasActive = false, netherSpawnTimer = 0;
let cheats = false;            // "sv cheats 1" seed: all items + the Aether
let peaceful = false;          // beta: no hostile mobs spawn, no hunger loss
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
let spawnTimer = 0, hurtCD = 0, fluidTimer = 0;
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

  // ---- secret Easter-egg seeds ----
  const rawSeed = ($('seed-input').value || '').trim();
  const compact = rawSeed.toLowerCase().replace(/\s+/g, '');   // ignore spaces/case
  cheats = false; peaceful = false;
  if (rawSeed === '478') selectedWorld = 'woolworld';          // flat random-wool world + sheep
  else if (compact === 'sheeep478') { selectedWorld = 'woolworld'; peaceful = true; }  // + statue + peaceful
  else if (rawSeed === '123') selectedWorld = 'simple';        // simple terrain
  else if (rawSeed === '333') selectedWorld = 'sandbox';       // flat sandstone, all items, no mobs
  else if (compact === 'svcheats1') cheats = true;             // all items + the Aether

  menuEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  const seedStr = rawSeed || ('sf' + Math.floor(Math.random() * 1e9));
  const seed = hashSeed(seedStr);

  // let the loading frame paint before heavy work
  setTimeout(() => initWorld(seed), 30);
}

function ensureNether() {
  if (netherWorld) return;
  netherWorld = new World(scene, (gameSeed ^ 0x9e3779b9) >>> 0, 'nether', overworld ? overworld.genVersion : undefined);
  if (isTouch) netherWorld.renderDistance = 3;
  netherMobs = new MobManager(netherWorld, scene);
  if (pendingNetherEdits) { netherWorld.loadEdits(pendingNetherEdits); pendingNetherEdits = null; }
}
function ensureAether() {
  if (aetherWorld) return;
  aetherWorld = new World(scene, (gameSeed ^ 0x5bf03635) >>> 0, 'aether', overworld ? overworld.genVersion : undefined);
  if (isTouch) aetherWorld.renderDistance = 3;
  aetherMobs = new MobManager(aetherWorld, scene);
  if (pendingAetherEdits) { aetherWorld.loadEdits(pendingAetherEdits); pendingAetherEdits = null; }
}
function ensureEnd() {
  if (endWorld) return;
  endWorld = new World(scene, (gameSeed ^ 0x1a2b3c4d) >>> 0, 'end', overworld ? overworld.genVersion : undefined);
  if (isTouch) endWorld.renderDistance = 3;
  endMobs = new MobManager(endWorld, scene);
  if (pendingEndEdits) { endWorld.loadEdits(pendingEndEdits); pendingEndEdits = null; }
}
function worldFor(dim) { return dim === 'nether' ? netherWorld : dim === 'aether' ? aetherWorld : dim === 'end' ? endWorld : overworld; }
function mobsFor(dim) { return dim === 'nether' ? netherMobs : dim === 'aether' ? aetherMobs : dim === 'end' ? endMobs : overworldMobs; }

function initWorld(seed, save) {
  if (!renderer) setupRenderer();

  // reset scene contents (all dimensions)
  if (overworld) overworld.hide();
  if (netherWorld) netherWorld.hide();
  if (aetherWorld) aetherWorld.hide();
  if (endWorld) endWorld.hide();
  if (overworldMobs) overworldMobs.clear();
  if (netherMobs) netherMobs.clear();
  if (aetherMobs) aetherMobs.clear();
  if (endMobs) endMobs.clear();
  netherWorld = null; netherMobs = null; aetherWorld = null; aetherMobs = null; endWorld = null; endMobs = null;
  portalCooldown = 0; portalTimer = 0; endFightWasActive = false;
  clearKineticVisuals(scene); machineState.clear(); clearKineticFacing(); placeGhost = null;
  if (save && save.machines) for (const [k, m] of save.machines) machineState.set(k, m);
  if (save && save.kFacing) loadKineticFacing(save.kFacing);

  if (save) { selectedMode = save.mode; selectedWorld = save.type; cheats = !!save.cheats; peaceful = !!save.peaceful; }
  dimension = 'overworld';
  endDragonDefeated = save ? !!save.endDragonDefeated : false;
  returnPos = save && save.returnPos ? save.returnPos : null;
  pendingNetherEdits = save && save.netherEdits && save.netherEdits.length ? save.netherEdits : null;
  pendingAetherEdits = save && save.aetherEdits && save.aetherEdits.length ? save.aetherEdits : null;
  pendingEndEdits = save && save.endEdits && save.endEdits.length ? save.endEdits : null;

  scene.clear();
  gameSeed = save ? (save.seed >>> 0) : (seed >>> 0);
  addLights();

  world = new World(scene, gameSeed, selectedWorld, save ? save.genVersion : undefined);
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
  spawnPoint = save && save.spawnPoint ? save.spawnPoint : null;
  cropTimer = 0; saplingTimer = 0;
  rsFacing.clear(); rsCompSub.clear();
  if (save && save.rsFacing) for (const [k, v] of save.rsFacing) rsFacing.set(k, v);
  if (save && save.rsCompSub) for (const k of save.rsCompSub) rsCompSub.add(k);
  craftGrid.fill(0); heldCraftItem = 0;
  buildItemIcons();
  setupInventory();
  rsButtons = [];
  if (!save) {
    if (cheats) applyCheats();                        // "sv cheats 1": all + best armor + Aether
    else if (selectedWorld === 'sandbox') giveEverything(false);   // "333": all items, no armor
  }
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
    } else if (save.dimension === 'aether') {
      ensureAether();
      world = aetherWorld; mobs = aetherMobs; dimension = 'aether'; player.world = world;
      world.preload(player.pos.x, player.pos.z);
    } else if (save.dimension === 'end') {
      ensureEnd();
      world = endWorld; mobs = endMobs; dimension = 'end'; player.world = world;
      world.preload(player.pos.x, player.pos.z);
      if (!endDragonDefeated) { endMobs.startEndFight(); endFightWasActive = true; }
    } else {
      world.preload(player.pos.x, player.pos.z);
    }
  } else {
    world.preload(sx, sz);                                   // generate terrain first
    const sy = world.surfaceY(Math.floor(sx), Math.floor(sz));
    player.pos.set(sx, sy + 1, sz);
    // skyblock: give a starter chest on the island
    if (selectedWorld === 'skyblock') addSkyblockChest();
    // sheeep478: a giant wool sheep statue greets you at spawn
    if (selectedWorld === 'woolworld' && peaceful) buildSheepStatue(Math.floor(sx) + 8, Math.floor(sz));
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
  else if (dimension === 'aether') { mobs = aetherMobs; }
  else {
    mobs = new MobManager(world, scene);
    overworldMobs = mobs;
    if (selectedWorld === 'sandbox') { /* no mobs */ }
    else if (selectedWorld === 'woolworld') {
      mobs.spawnInitial(player.pos.x, player.pos.z, isTouch ? 12 : 20, 26, 'sheep');
      for (const t of ['sheep_coal', 'sheep_iron', 'sheep_gold', 'sheep_diamond', 'sheep_redstone'])
        mobs.spawnInitial(player.pos.x, player.pos.z, isTouch ? 2 : 3, 28, t);   // ore/resource sheep
    } else if (selectedWorld === 'skyblock') mobs.spawnInitial(player.pos.x, player.pos.z, 3, 3);
    else mobs.spawnInitial(player.pos.x, player.pos.z, isTouch ? 5 : 8, 16);
  }
  if (!overworldMobs) { overworldMobs = new MobManager(overworld, scene); }

  updateStats();

  loadingEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' +
    (dimension === 'overworld' ? selectedWorld : dimension);
  $('stats').style.display = selectedMode === 'survival' ? 'flex' : 'none';
  setDimensionVisuals();
  refreshKinetics();

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
  if (dimension === 'nether' || dimension === 'aether' || dimension === 'end') { world.dayUniform.value = 1.0; return; }
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
  } else if (dimension === 'aether') {
    scene.background = new THREE.Color(0xdff0ff);
    scene.fog = new THREE.Fog(0xdff0ff, CHUNK * 3, CHUNK * (isTouch ? 3.6 : 4.6));
  } else if (dimension === 'end') {
    scene.background = new THREE.Color(0x0b0613);
    scene.fog = new THREE.Fog(0x0b0613, CHUNK * 2.6, CHUNK * (isTouch ? 3.4 : 4.6));
  } else {
    scene.background = new THREE.Color(0x8fc7ee);
    scene.fog = new THREE.Fog(0x8fc7ee, CHUNK * 2.5, CHUNK * (isTouch ? 3.2 : 4.2));
  }
}

// Re-scan + repower the kinetic network for the world we're currently in, and
// rebuild the spinning overlays. Call whenever the active world changes.
function refreshKinetics() {
  clearKineticVisuals(scene);
  scanKinetics(world);
  recomputeKinetics(world);
  rebuildKineticVisuals(world, scene);
}

// ---- placement assist: a translucent ghost of where the held block will land ----
let placeGhost = null;
function ensurePlaceGhost() {
  if (placeGhost && placeGhost.parent === scene) return;
  const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
  placeGhost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7ec8ff, transparent: true, opacity: 0.25, depthWrite: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  placeGhost.add(edges);
  placeGhost.visible = false;
  scene.add(placeGhost);
}
function updatePlaceGhost() {
  ensurePlaceGhost();
  const item = activeItem();
  const placeable = item != null && isBlockItem(item) && PALETTE.includes(item);
  if (!running || paused || furnaceOpen || chestOpen || settingsOpen || !placeable) { placeGhost.visible = false; return; }
  const hit = raycast();
  if (!hit) { placeGhost.visible = false; return; }
  const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
  if (world.getBlock(px, py, pz) !== BLOCK.AIR || overlapsPlayer(px, py, pz)) { placeGhost.visible = false; return; }
  placeGhost.position.set(px + 0.5, py + 0.5, pz + 0.5);
  placeGhost.visible = true;
}

// ---------------- inventory + items ----------------
const inventory = {};        // itemId -> count (Infinity in creative)
let hotbarItems = [];        // itemIds shown on the hotbar

const ALL_TOOLS = [ITEM.W_PICK, ITEM.W_AXE, ITEM.W_SHOVEL, ITEM.W_SWORD, ITEM.W_HOE,
                   ITEM.S_PICK, ITEM.S_AXE, ITEM.S_SHOVEL, ITEM.S_SWORD, ITEM.S_HOE,
                   ITEM.I_PICK, ITEM.I_AXE, ITEM.I_SHOVEL, ITEM.I_SWORD, ITEM.I_HOE,
                   ITEM.D_PICK, ITEM.D_AXE, ITEM.D_SHOVEL, ITEM.D_SWORD];
// extra non-block items shown in creative
const CREATIVE_EXTRA = [ITEM.WHEAT_SEEDS, BLOCK.SAPLING, BLOCK.TALL_GRASS, ITEM.BREAD,
  ITEM.BUCKET, ITEM.WATER_BUCKET, ITEM.LAVA_BUCKET,
  ITEM.ENDER_PEARL, ITEM.BLAZE_ROD, ITEM.BLAZE_POWDER, ITEM.EYE_OF_ENDER,
  ITEM.ANDESITE_ALLOY, ITEM.BRASS_INGOT, ITEM.IRON_SHEET, ITEM.BRASS_SHEET,
  ITEM.CRUSHED_IRON, ITEM.CRUSHED_GOLD, ITEM.WHEAT_FLOUR, ITEM.DOUGH,
  ITEM.L_HELM, ITEM.L_CHEST, ITEM.L_LEGS, ITEM.L_BOOTS,
  ITEM.I_HELM, ITEM.I_CHEST, ITEM.I_LEGS, ITEM.I_BOOTS];
let furnaceOpen = false;

// armor + farming state
const equippedArmor = { helmet: 0, chest: 0, legs: 0, boots: 0 };
let crops = [], cropTimer = 0;
let saplings = [], saplingTimer = 0;
let spawnPoint = null;   // bed respawn point {x,y,z} in the overworld
let rsButtons = [];      // active buttons {x,y,z,t} reverting after a pulse

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

// fill the inventory with everything (used by the cheats + sandbox seeds)
function giveEverything(equipArmor) {
  const misc = [ITEM.STICK, ITEM.COAL, ITEM.DIAMOND, ITEM.IRON_INGOT, ITEM.GOLD_INGOT,
    ITEM.LEATHER, ITEM.WHEAT, ITEM.WHEAT_SEEDS, ITEM.BREAD, ITEM.PORKCHOP, ITEM.CHICKEN,
    ITEM.MUTTON, ITEM.BUCKET, ITEM.WATER_BUCKET, ITEM.LAVA_BUCKET, BLOCK.SAPLING, BLOCK.TALL_GRASS,
    ITEM.ENDER_PEARL, ITEM.BLAZE_ROD, ITEM.BLAZE_POWDER, ITEM.EYE_OF_ENDER,
    ITEM.ANDESITE_ALLOY, ITEM.BRASS_INGOT, ITEM.IRON_SHEET, ITEM.BRASS_SHEET,
    ITEM.CRUSHED_IRON, ITEM.CRUSHED_GOLD, ITEM.WHEAT_FLOUR, ITEM.DOUGH];
  for (const id of PALETTE) inventory[id] = 64;
  for (const [id] of WOOL_COLORS) inventory[id] = 64;              // every wool colour
  for (const id of ALL_TOOLS) inventory[id] = 1;
  for (const id of misc) inventory[id] = 16;
  const armorIds = [ITEM.L_HELM, ITEM.L_CHEST, ITEM.L_LEGS, ITEM.L_BOOTS,
    ITEM.I_HELM, ITEM.I_CHEST, ITEM.I_LEGS, ITEM.I_BOOTS];
  for (const id of armorIds) inventory[id] = 1;
  if (equipArmor) {
    equippedArmor.helmet = ITEM.I_HELM; equippedArmor.chest = ITEM.I_CHEST;
    equippedArmor.legs = ITEM.I_LEGS; equippedArmor.boots = ITEM.I_BOOTS;
    delete inventory[ITEM.I_HELM]; delete inventory[ITEM.I_CHEST];
    delete inventory[ITEM.I_LEGS]; delete inventory[ITEM.I_BOOTS];
  }
  refreshHotbar(true);
}
function applyCheats() {
  giveEverything(true);
  flash('sv cheats 1 — light a GLOWSTONE portal to reach the Aether');
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
  updateItemName();
}

// the big centered label above the hotbar showing what you're holding
function updateItemName() {
  const el = $('item-name');
  if (!el) return;
  const id = hotbarItems.length ? hotbarItems[hotbarIndex] : null;
  if (id == null) { el.classList.add('hidden'); return; }
  el.textContent = itemName(id);
  el.classList.remove('hidden');
}

function selectHotbar(i) {
  if (!hotbarItems.length) return;
  hotbarIndex = (i + hotbarItems.length) % hotbarItems.length;
  buildHotbarDOM();
  if (running && activeItem() === ITEM.EYE_OF_ENDER && dimension === 'overworld') locateStronghold();
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
    it.className = 'inv-item' + (id === heldCraftItem ? ' held' : '');
    it.addEventListener('click', () => {
      if (isArmor(id)) { equipArmor(id); }
      else { heldCraftItem = (heldCraftItem === id ? 0 : id); buildInventory(); }
    });
    grid.appendChild(it);
  });
  updateCraftHeld();
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

// ---- crafting grid: 2x2 in the inventory, 3x3 at a crafting table ----
const craftGrid = new Array(9).fill(0);   // stored as 3x3 (top-left used for 2x2)
let heldCraftItem = 0;
let craftCols = 2;

function buildCraftGrid() {
  const g = $('craft-grid');
  if (!g) return;
  g.innerHTML = '';
  g.style.gridTemplateColumns = `repeat(${craftCols}, 46px)`;
  g.style.gridTemplateRows = `repeat(${craftCols}, 46px)`;
  for (let r = 0; r < craftCols; r++)
    for (let c = 0; c < craftCols; c++) {
      const idx = r * 3 + c;                 // map display cell -> 3x3 storage
      const id = craftGrid[idx];
      const cell = document.createElement('div');
      cell.className = 'craft-cell' + (id ? ' filled' : '');
      if (id) cell.innerHTML = `<div class="swatch" style="${iconStyle(id)}"></div>`;
      cell.addEventListener('click', () => onCraftCell(idx));
      g.appendChild(cell);
    }
  updateCraftResult();
}
function openCraftingTable() {
  if (!running || paused || furnaceOpen || chestOpen || settingsOpen) return;
  craftCols = 3;
  paused = true;
  pauseEl.classList.remove('hidden');
  onBreakRelease();
  buildInventory(); buildCrafting();
  saveGame();
  if (document.pointerLockElement) document.exitPointerLock();
}
function onCraftCell(i) {
  if (craftGrid[i]) { give(craftGrid[i], 1); craftGrid[i] = 0; }   // take it back
  else if (heldCraftItem && (inventory[heldCraftItem] || 0) > 0) { take(heldCraftItem, 1); craftGrid[i] = heldCraftItem; }
  buildCraftGrid(); buildInventory();
}
function updateCraftResult() {
  const res = craftResult(craftGrid);
  const slot = $('craft-result');
  if (!slot) return;
  slot.innerHTML = res
    ? `<div class="swatch" style="${iconStyle(res.out)}"></div>` + (res.n > 1 ? `<span class="count">${res.n}</span>` : '')
    : '';
  slot.classList.toggle('ready', !!res);
}
function doCraft() {
  const res = craftResult(craftGrid);
  if (!res) return;
  craftGrid.fill(0);              // ingredients consumed (one per cell)
  give(res.out, res.n);
  buildCraftGrid(); buildInventory();
  flash('Crafted ' + itemName(res.out));
}
function returnCraftGrid() {       // give grid contents back (e.g. when closing)
  let any = false;
  for (let i = 0; i < 9; i++) if (craftGrid[i]) { give(craftGrid[i], 1); craftGrid[i] = 0; any = true; }
  if (any) buildCraftGrid();
}
function updateCraftHeld() {
  const el = $('craft-held');
  if (el) el.textContent = heldCraftItem ? 'Holding: ' + itemName(heldCraftItem) + ' — tap a grid cell' : 'Tap an item below, then tap the grid';
}

// recipe reference list: tap to auto-fill the grid from your inventory
function buildCrafting() {
  buildCraftGrid();
  const list = $('crafting-list');
  list.innerHTML = '';
  RECIPES.forEach((r, ri) => {
    const ing = recipeIn(r).map(([id, n]) =>
      `<span class="ing"><span class="swatch sm" style="${iconStyle(id)}"></span>${n}</span>`).join('');
    const row = document.createElement('div');
    row.className = 'recipe'; row.dataset.ri = ri;
    row.innerHTML =
      `<div class="recipe-out"><span class="swatch" style="${iconStyle(r.out)}"></span>` +
      `<span class="recipe-name">${itemName(r.out)}${r.n > 1 ? ' ×' + r.n : ''}</span></div>` +
      `<div class="recipe-ings">${ing}</div>` +
      `<button class="craft-btn">Fill</button>`;
    row.querySelector('.craft-btn').addEventListener('click', () => autoFill(r));
    list.appendChild(row);
  });
  refreshCrafting();
}
function refreshCrafting() {
  document.querySelectorAll('#crafting-list .recipe').forEach((row) => {
    const r = RECIPES[+row.dataset.ri];
    const fits = recipeFits(r, craftCols);
    const ok = fits && canCraft(inventory, r);
    row.classList.toggle('disabled', !ok);
    const btn = row.querySelector('.craft-btn');
    btn.disabled = !ok;
    btn.textContent = fits ? 'Fill' : 'Table';   // hint: needs a crafting table
  });
}
// auto-place a recipe's pattern into the grid from inventory, then it's ready to craft
function autoFill(r) {
  if (!recipeFits(r, craftCols)) { flash('Needs a crafting table'); return; }
  if (!canCraft(inventory, r)) { flash('Not enough materials'); return; }
  returnCraftGrid();
  if (r.shapeless) {
    let i = 0;
    for (const id of r.shapeless) { take(id, 1); craftGrid[i++] = id; }
  } else {
    for (let rr = 0; rr < r.rows.length; rr++)
      for (let cc = 0; cc < r.rows[rr].length; cc++) {
        const ch = r.rows[rr][cc];
        if (ch !== '.') { const id = r.key[ch]; take(id, 1); craftGrid[rr * 3 + cc] = id; }
      }
  }
  buildCraftGrid(); buildInventory();
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
    if (e.code === 'KeyT') locateStronghold();
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
function raycast(maxDist = 6, includeLiquid = false) {
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
    if (b !== BLOCK.AIR && bi && (bi.solid || bi.crop || bi.rs || (includeLiquid && bi.liquid))) {
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
  const reach = dimension === 'end' ? 6 : 3.2;     // longer reach to pick off End Crystals
  const drops = mobs.attack(player.getEyePos(), player.getDirection(), reach, dmg);
  if (drops) { if (selectedMode === 'survival') for (const d of drops) give(d.id, d.n); return; }
  if (selectedMode === 'creative') { mineInstant(); return; }
  miningActive = true;            // survival: hold to break (handled in loop)
}
function onBreakRelease() {
  miningActive = false; miningTarget = null; miningProgress = 0;
  showMining(-1);
}
// Detach a kinetic block when removed: dump machine contents (to inventory if
// collect), then drop it from the network and refresh power + spinning visuals.
function clearKineticAt(x, y, z, block, collect) {
  if (isMachine(block)) { const drops = machineDump(dimension, x, y, z); if (collect) for (const d of drops) give(d.id, d.n); }
  if (isKinetic(block)) { unregisterKinetic(x, y, z); recomputeKinetics(world); rebuildKineticVisuals(world, scene); }
}
function mineInstant() {
  const hit = raycast();
  if (!hit || BLOCK_INFO[hit.block].unbreakable) return;
  world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
  if (hit.block === BLOCK.SAPLING) removeSapling(hit.x, hit.y, hit.z);
  else if (BLOCK_INFO[hit.block].crop) removeCrop(hit.x, hit.y, hit.z);
  if (hit.block === BLOCK.CHEST) dumpChest(hit.x, hit.y, hit.z);
  if (isKinetic(hit.block)) clearKineticAt(hit.x, hit.y, hit.z, hit.block, false);
  rsFacing.delete(hit.x + ',' + hit.y + ',' + hit.z); rsCompSub.delete(hit.x + ',' + hit.y + ',' + hit.z);
  maybeUpdateRedstone(world, hit.x, hit.y, hit.z);
}
function doBreakSurvival(hit) {
  if (BLOCK_INFO[hit.block].unbreakable) return;
  const tool = activeTool();
  world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
  if (hit.block === BLOCK.SAPLING) { removeSapling(hit.x, hit.y, hit.z); give(BLOCK.SAPLING, 1); return; }
  if (hit.block === BLOCK.TALL_GRASS) { if (Math.random() < 0.5) give(ITEM.WHEAT_SEEDS, 1); return; }
  if (BLOCK_INFO[hit.block].crop) { harvestCrop(hit.block, hit.x, hit.y, hit.z); return; }
  if (hit.block === BLOCK.CHEST) dumpChest(hit.x, hit.y, hit.z);
  const drop = blockDrop(hit.block, tool);
  if (drop) give(drop.id, drop.n);
  // leaves occasionally yield a sapling
  if (hit.block === BLOCK.LEAVES && Math.random() < 0.1) give(BLOCK.SAPLING, 1);
  if (isKinetic(hit.block)) clearKineticAt(hit.x, hit.y, hit.z, hit.block, true);
  rsFacing.delete(hit.x + ',' + hit.y + ',' + hit.z); rsCompSub.delete(hit.x + ',' + hit.y + ',' + hit.z);
  maybeUpdateRedstone(world, hit.x, hit.y, hit.z);
}

// place a block OR use the held item (eat / till / plant)
function placeBlock() {
  if (!running || paused || furnaceOpen || chestOpen || settingsOpen) return;
  const item = activeItem();
  if (isFood(item)) { eatFood(item); return; }   // food needs no target
  // empty bucket: scoop the liquid you're aiming at
  if (item === ITEM.BUCKET) {
    const lh = raycast(6, true);
    if (lh && BLOCK_INFO[lh.block].liquid) {
      world.setBlock(lh.x, lh.y, lh.z, BLOCK.AIR);
      take(ITEM.BUCKET, 1);
      give(lh.block === BLOCK.WATER ? ITEM.WATER_BUCKET : ITEM.LAVA_BUCKET, 1);
      flash('Filled bucket');
    }
    return;
  }
  // filled bucket: pour the liquid onto the targeted face
  if (item === ITEM.WATER_BUCKET || item === ITEM.LAVA_BUCKET) {
    const lh = raycast();
    if (!lh) return;
    const px = lh.x + lh.nx, py = lh.y + lh.ny, pz = lh.z + lh.nz;
    if (world.getBlock(px, py, pz) === BLOCK.AIR && !overlapsPlayer(px, py, pz)) {
      world.setBlock(px, py, pz, item === ITEM.WATER_BUCKET ? BLOCK.WATER : BLOCK.LAVA);
      take(item, 1); give(ITEM.BUCKET, 1);
    }
    return;
  }
  const hit = raycast();
  if (!hit) return;
  // interact with stations / bed
  if (hit.block === BLOCK.FURNACE) { openFurnace(); return; }
  if (hit.block === BLOCK.CHEST) { openChest(hit.x, hit.y, hit.z); return; }
  if (hit.block === BLOCK.CRAFTING_TABLE) { openCraftingTable(); return; }
  if (hit.block === BLOCK.BED) { sleep(hit.x, hit.y, hit.z); return; }
  // redstone: flip levers, press buttons
  if (hit.block === BLOCK.LEVER || hit.block === BLOCK.LEVER_ON) {
    world.setBlock(hit.x, hit.y, hit.z, hit.block === BLOCK.LEVER ? BLOCK.LEVER_ON : BLOCK.LEVER);
    updateRedstone(world, hit.x, hit.y, hit.z);
    return;
  }
  if (hit.block === BLOCK.BUTTON) {
    world.setBlock(hit.x, hit.y, hit.z, BLOCK.BUTTON_ON);
    rsButtons.push({ x: hit.x, y: hit.y, z: hit.z, t: 1.0 });
    updateRedstone(world, hit.x, hit.y, hit.z);
    return;
  }
  if (hit.block === BLOCK.COMPARATOR || hit.block === BLOCK.COMPARATOR_ON) {
    const k = hit.x + ',' + hit.y + ',' + hit.z;
    if (rsCompSub.has(k)) rsCompSub.delete(k); else rsCompSub.add(k);
    flash(rsCompSub.has(k) ? 'Comparator: subtract' : 'Comparator: compare');
    updateRedstone(world, hit.x, hit.y, hit.z);
    return;
  }
  // Create: hand crank — give it a spin
  if (hit.block === BLOCK.HAND_CRANK) {
    handCrankSpin.set(kKey(hit.x, hit.y, hit.z), 8);
    recomputeKinetics(world);
    flash('Cranking…');
    return;
  }
  // Create: machines — insert a valid input, or collect finished output
  if (isMachine(hit.block)) {
    if (item && !isTool(item) && machineInsert(world, dimension, hit.x, hit.y, hit.z, hit.block, item)) {
      if (selectedMode === 'survival') take(item, 1);
      flash('Loaded ' + itemName(item));
    } else {
      const out = machineCollect(dimension, hit.x, hit.y, hit.z);
      if (out) { give(out.id, out.n); flash('Collected ' + out.n + '× ' + itemName(out.id)); }
      else flash(itemName(hit.block) + (kSpeed.get(kKey(hit.x, hit.y, hit.z)) ? ' is running' : ' needs rotation'));
    }
    return;
  }
  // hoe: till grass/dirt into farmland (wet if near water)
  const tool = TOOLS[item];
  if (tool && tool.type === 'hoe') {
    if ((hit.block === BLOCK.GRASS || hit.block === BLOCK.DIRT) &&
        world.getBlock(hit.x, hit.y + 1, hit.z) === BLOCK.AIR) {
      const wet = nearWater(hit.x, hit.y, hit.z);
      world.setBlock(hit.x, hit.y, hit.z, wet ? BLOCK.FARMLAND_WET : BLOCK.FARMLAND);
      flash(wet ? 'Tilled wet soil' : 'Tilled soil');
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
  // eye of ender: set into an empty End-portal frame, activating it once all 12 are filled
  if (item === ITEM.EYE_OF_ENDER && hit.block === BLOCK.END_PORTAL_FRAME) {
    world.setBlock(hit.x, hit.y, hit.z, BLOCK.END_PORTAL_FRAME_EYE);
    if (selectedMode === 'survival') take(ITEM.EYE_OF_ENDER, 1);
    if (!tryActivateEndPortal(hit.x, hit.y, hit.z)) flash('Eye of Ender set into the frame');
    return;
  }
  // seeds: plant on farmland (dry or wet)
  if (item === ITEM.WHEAT_SEEDS) {
    if ((hit.block === BLOCK.FARMLAND || hit.block === BLOCK.FARMLAND_WET) &&
        world.getBlock(hit.x, hit.y + 1, hit.z) === BLOCK.AIR) {
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
  // pistons/repeaters/comparators remember the direction you placed them facing
  if (id === BLOCK.PISTON || id === BLOCK.PISTON_STICKY || id === BLOCK.REPEATER || id === BLOCK.COMPARATOR) {
    rsFacing.set(px + ',' + py + ',' + pz, facingFromYaw(player.yaw));
  }
  world.setBlock(px, py, pz, id);
  if (selectedMode === 'survival') take(item, 1);
  maybeUpdateRedstone(world, px, py, pz);
  if (isKinetic(id)) {
    setKineticAxis(px, py, pz, hit.nx ? 'x' : hit.ny ? 'y' : 'z');   // align to the face placed against
    registerKinetic(px, py, pz); recomputeKinetics(world); rebuildKineticVisuals(world, scene);
  }
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
function nearWater(x, y, z) {
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++)
      for (let dy = 0; dy <= 1; dy++)
        if (world.getBlock(x + dx, y + dy, z + dz) === BLOCK.WATER) return true;
  return false;
}
function sleep(bx, by, bz) {
  if (dimension !== 'overworld') { flash('You can only sleep in the overworld'); return; }
  spawnPoint = { x: bx, y: by, z: bz };
  if (isNight()) {
    timeOfDay = 0.0;                 // skip to morning
    if (mobs) mobs.clearHostiles();
    if (selectedMode === 'survival' && health < 20) { health = Math.min(20, health + 4); updateStats(); }
    flash('Good morning! Spawn point set');
  } else {
    flash('Spawn point set');
  }
}
// cobblestone generator: an air cell touching both water and lava turns to
// cobblestone. Build a lava + water with a 1-block gap to make a renewable one.
const _NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function fluidTick(dt) {
  fluidTimer += dt;
  if (fluidTimer < 0.8) return;
  fluidTimer = 0;
  const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
  const R = 6;
  for (let x = px - R; x <= px + R; x++)
    for (let y = py - R; y <= py + R; y++)
      for (let z = pz - R; z <= pz + R; z++) {
        if (world.getBlock(x, y, z) !== BLOCK.AIR) continue;
        let w = false, l = false;
        for (const n of _NB6) {
          const b = world.getBlock(x + n[0], y + n[1], z + n[2]);
          if (b === BLOCK.WATER) w = true; else if (b === BLOCK.LAVA) l = true;
        }
        if (w && l) world.setBlock(x, y, z, BLOCK.COBBLE);
      }
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
    const wet = world.getBlock(c.x, c.y - 1, c.z) === BLOCK.FARMLAND_WET;
    if (Math.random() < (wet ? 0.5 : 0.28)) {
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

// ---------------- portals ----------------
// Detect a rectangular air area enclosed by `frame` blocks, in a vertical plane.
function findPortalArea(w, ix, iy, iz, frame) {
  frame = frame || BLOCK.OBSIDIAN;
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
      if (get(left - 1, b) !== frame || get(right + 1, b) !== frame) ok = false;
    for (let a = left; a <= right && ok; a++)
      if (get(a, bot - 1) !== frame || get(a, top + 1) !== frame) ok = false;
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
  // obsidian frame -> Nether; glowstone frame -> Aether (cheats seed only)
  let frame = null, fill = null;
  if (hit && hit.block === BLOCK.OBSIDIAN) { frame = BLOCK.OBSIDIAN; fill = BLOCK.PORTAL; }
  else if (hit && hit.block === BLOCK.GLOWSTONE && cheats) { frame = BLOCK.GLOWSTONE; fill = BLOCK.AETHER_PORTAL; }
  else if (hit && hit.block === BLOCK.GLOWSTONE) { flash('Aether portals need the secret seed'); return; }
  else { flash('Aim at an obsidian frame'); return; }
  // try the air cell in front first, then any air neighbour of the frame block,
  // so it lights no matter which face/edge you're aiming at.
  const cand = [[hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz]];
  for (const n of _NB6) cand.push([hit.x + n[0], hit.y + n[1], hit.z + n[2]]);
  let area = null;
  for (const [ix, iy, iz] of cand) {
    if (world.getBlock(ix, iy, iz) !== BLOCK.AIR) continue;
    area = findPortalArea(world, ix, iy, iz, frame);
    if (area) break;
  }
  if (!area) { flash('Need a hollow 4×5 frame (sealed edges, empty middle)'); return; }
  for (const c of area.cells) world.setBlock(c[0], c[1], c[2], fill, false);
  world.remeshArea(area.minX, area.maxX, area.minZ, area.maxZ);
  flash((fill === BLOCK.AETHER_PORTAL ? 'Aether portal' : 'Portal') + ' lit! Step through…');
}

// Build a ready-made 4x5 portal (2x3 interior) at a destination.
function buildPortalStructure(w, bx, by, bz, frame, fill) {
  for (let x = bx - 1; x <= bx + 2; x++)
    for (let y = by - 1; y <= by + 3; y++) {
      const edge = (x === bx - 1 || x === bx + 2 || y === by - 1 || y === by + 3);
      w.setBlock(x, y, bz, edge ? frame : fill, false);
    }
  // clear standing room in front of the portal
  for (let x = bx - 1; x <= bx + 2; x++)
    for (let y = by; y <= by + 2; y++)
      for (let dz = 1; dz <= 2; dz++) w.setBlock(x, y, bz + dz, BLOCK.AIR, false);
  w.remeshArea(bx - 2, bx + 3, bz - 1, bz + 3);
}

// travel between the overworld and a target dimension ('nether' | 'aether')
function teleport(target) {
  const entryX = Math.floor(player.pos.x), entryZ = Math.floor(player.pos.z);
  world.hide(); mobs.hide();

  if (dimension === 'overworld') {
    returnPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
    if (target === 'aether') ensureAether(); else ensureNether();
    dimension = target;
    world = worldFor(target); mobs = mobsFor(target); player.world = world;
    if (target === 'aether') {
      const dx = entryX, dz = entryZ;
      world.preload(dx + 0.5, dz + 0.5);
      let by = world.surfaceY(dx, dz);
      if (by <= 0) { for (let x = dx - 2; x <= dx + 2; x++) for (let z = dz - 2; z <= dz + 2; z++) world.setBlock(x, 44, z, BLOCK.AETHER_GRASS); by = 45; }
      buildPortalStructure(world, dx, by, dz, BLOCK.GLOWSTONE, BLOCK.AETHER_PORTAL);
      player.pos.set(dx + 0.5, by + 1, dz + 1.5);
    } else {
      const dx = Math.round(entryX / 4), dz = Math.round(entryZ / 4);
      world.preload(dx + 0.5, dz + 0.5);
      const by = world.floorY(dx, dz, 40);
      buildPortalStructure(world, dx, by, dz, BLOCK.OBSIDIAN, BLOCK.PORTAL);
      const sy = world.floorY(dx, dz + 1, 40);
      player.pos.set(dx + 0.5, sy, dz + 1.5);
    }
  } else {
    dimension = 'overworld';
    world = overworld; mobs = overworldMobs; player.world = world;
    if (returnPos) player.pos.set(returnPos.x, returnPos.y, returnPos.z);
  }

  player.vel.set(0, 0, 0);
  world.show(); mobs.show();
  setDimensionVisuals();
  refreshKinetics();
  portalCooldown = 2.2; portalTimer = 0;
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' +
    (dimension === 'overworld' ? selectedWorld : dimension);
}

// ---- The End: travel + boss arena ----
function enterEnd() {
  returnPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
  world.hide(); mobs.hide();
  ensureEnd();
  dimension = 'end'; world = endWorld; mobs = endMobs; player.world = world;
  // arrive on the island (near the +Z rim) with a small obsidian safety platform
  const ax = 0, az = 40;
  world.preload(ax + 0.5, az + 0.5);
  const py = world.surfaceY(ax, az);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
    if (world.getBlock(ax + dx, py - 1, az + dz) === BLOCK.AIR) world.setBlock(ax + dx, py - 1, az + dz, BLOCK.OBSIDIAN, false);
  world.remeshArea(ax - 2, ax + 2, az - 2, az + 2);
  player.pos.set(ax + 0.5, py + 0.1, az + 0.5); player.vel.set(0, 0, 0);
  if (endDragonDefeated) { buildEndExitPortal(); flash('The End is still. Step into the portal to return home.'); }
  else { mobs.startEndFight(); endFightWasActive = true; flash('Destroy the End Crystals, then slay the Ender Dragon!'); }
  world.show(); mobs.show(); setDimensionVisuals();
  refreshKinetics();
  portalCooldown = 2.5; portalTimer = 0;
  updateModeLabel();
}
function exitEnd() {
  world.hide(); mobs.hide();
  dimension = 'overworld'; world = overworld; mobs = overworldMobs; player.world = world;
  if (returnPos) player.pos.set(returnPos.x, returnPos.y, returnPos.z);
  player.vel.set(0, 0, 0);
  world.show(); mobs.show(); setDimensionVisuals();
  refreshKinetics();
  portalCooldown = 2.5; portalTimer = 0;
  updateModeLabel();
}
function updateModeLabel() {
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' +
    (dimension === 'overworld' ? selectedWorld : dimension);
}
// once the dragon is slain: bedrock fountain with the exit portal + the dragon egg
function buildEndExitPortal() {
  const w = world, cx = 0, cz = 0, yt = END_BASE + 7;
  w.preload(cx + 0.5, cz + 0.5);
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      const inner = Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
      w.setBlock(cx + dx, yt, cz + dz, inner ? BLOCK.END_PORTAL : BLOCK.BEDROCK, false);
    }
  w.setBlock(cx, yt, cz, BLOCK.BEDROCK, false);            // central pillar base
  w.setBlock(cx, yt + 1, cz, BLOCK.DRAGON_EGG, false);     // the prize
  w.remeshArea(cx - 3, cx + 3, cz - 3, cz + 3);
}
function onDragonDefeated() {
  endDragonDefeated = true; endFightWasActive = false;
  buildEndExitPortal();
  flash('The Ender Dragon is slain! A portal home opens at the centre.');
  saveGame();
}
function updateBossBar() {
  const bar = $('boss-bar'); if (!bar) return;
  const d = dimension === 'end' ? mobs.dragon : null;
  if (!d) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const fill = $('boss-fill'); if (fill) fill.style.width = Math.max(0, Math.min(100, d.hp / d.maxhp * 100)) + '%';
  const label = $('boss-label');
  if (label) {
    const c = mobs.crystalsAlive();
    label.textContent = c > 0 ? '🐉 Ender Dragon — ' + c + ' crystal' + (c > 1 ? 's' : '') + ' shielding it' : '🐉 Ender Dragon — vulnerable!';
  }
}

// ---- End-portal frame activation (stronghold) ----
function isEyedFrame(x, y, z) { return world.getBlock(x, y, z) === BLOCK.END_PORTAL_FRAME_EYE; }
function endFramesComplete(cx, fy, cz) {
  for (let d = -1; d <= 1; d++) {
    if (!isEyedFrame(cx - 2, fy, cz + d)) return false;
    if (!isEyedFrame(cx + 2, fy, cz + d)) return false;
    if (!isEyedFrame(cx + d, fy, cz - 2)) return false;
    if (!isEyedFrame(cx + d, fy, cz + 2)) return false;
  }
  return true;
}
function tryActivateEndPortal(fx, fy, fz) {
  // the true centre lies within 2 blocks of any frame — scan the neighbourhood
  for (let cxo = -2; cxo <= 2; cxo++)
    for (let czo = -2; czo <= 2; czo++) {
      const cx = fx + cxo, cz = fz + czo;
      if (!endFramesComplete(cx, fy, cz)) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        world.setBlock(cx + dx, fy, cz + dz, BLOCK.END_PORTAL, false);
      world.remeshArea(cx - 2, cx + 2, cz - 2, cz + 2);
      flash('The End portal awakens! Step in to reach the End.');
      return true;
    }
  return false;
}

// ---- eye-of-ender stronghold locator ----
function compassDir(dx, dz) {
  const a = ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;   // 0=N, 90=E
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8];
}
function locateStronghold() {
  if (dimension !== 'overworld') { flash('Eyes of Ender only point true in the overworld'); return; }
  const list = overworld.strongholds ? overworld.strongholds() : [];
  if (!list.length) { flash('No strongholds in this world'); return; }
  let best = null, bd = Infinity;
  for (const s of list) { const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z); if (d < bd) { bd = d; best = s; } }
  flash('Stronghold: ' + compassDir(best.x - player.pos.x, best.z - player.pos.z) + ' · ' + Math.round(bd) + 'm');
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
    craftCols = 2;                    // inventory only has a 2x2 grid
    onBreakRelease();                 // stop mining while in the menu
    buildInventory(); buildCrafting();
    saveGame();
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    returnCraftGrid(); heldCraftItem = 0;
    lastTime = performance.now();
  }
}
function quitToMenu() {
  returnCraftGrid(); heldCraftItem = 0;
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
      genVersion: overworld ? overworld.genVersion : 1,
      cheats, peaceful, dimension, timeOfDay, endDragonDefeated,
      player: {
        x: player.pos.x, y: player.pos.y, z: player.pos.z,
        yaw: player.yaw, pitch: player.pitch, health, hunger,
      },
      inv: selectedMode === 'survival' ? { ...inventory } : null,
      armor: { ...equippedArmor },
      activeItem: hotbarItems[hotbarIndex],
      crops, saplings, chests, returnPos, spawnPoint,
      rsFacing: [...rsFacing.entries()], rsCompSub: [...rsCompSub],
      overworldEdits: overworld ? overworld.serializeEdits() : [],
      netherEdits: netherWorld ? netherWorld.serializeEdits() : (pendingNetherEdits || []),
      aetherEdits: aetherWorld ? aetherWorld.serializeEdits() : (pendingAetherEdits || []),
      endEdits: endWorld ? endWorld.serializeEdits() : (pendingEndEdits || []),
      machines: [...machineState.entries()],
      kFacing: [...kFacing.entries()],
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
// sheeep478 Easter egg: a big blocky wool sheep statue at spawn
function buildSheepStatue(cx, cz) {
  const gy = world.surfaceY(cx, cz);                 // ground level under the statue
  const W = BLOCK.WOOL, K = BLOCK.WOOL_BLACK;
  const set = (x, y, z, id) => world.setBlock(cx + x, gy + y, cz + z, id, false);
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  const fill = (x0, x1, y0, y1, z0, z1, id) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, id);
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
    minZ = Math.min(minZ, z0); maxZ = Math.max(maxZ, z1);
  };
  // legs (4), fluffy body, head and black eyes — a chunky Minecraft-style sheep
  for (const [lx, lz] of [[-2, -2], [1, -2], [-2, 1], [1, 1]]) fill(lx, lx + 1, 0, 1, lz, lz + 1, W);
  fill(-2, 2, 2, 5, -2, 2, W);                       // woolly body
  fill(-1, 1, 3, 6, 3, 4, W);                        // neck/back fluff toward the head
  fill(-1, 1, 2, 4, 3, 5, W);                        // head block out front
  set(-1, 4, 5, K); set(1, 4, 5, K);                 // two eyes
  world.remeshArea(cx + minX - 1, cx + maxX + 1, cz + minZ - 1, cz + maxZ + 1);
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
    if (!peaceful && hungerTimer > 14) { hungerTimer = 0; if (hunger > 0) { hunger--; updateStats(); } }
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

  // portals: stand in a portal block briefly to travel
  if (portalCooldown > 0) portalCooldown -= dt;
  const fx = Math.floor(player.pos.x), fz = Math.floor(player.pos.z);
  const pf = world.getBlock(fx, Math.floor(player.pos.y), fz);
  const pf2 = world.getBlock(fx, Math.floor(player.pos.y + 1), fz);
  const onNether = pf === BLOCK.PORTAL || pf2 === BLOCK.PORTAL;
  const onAether = pf === BLOCK.AETHER_PORTAL || pf2 === BLOCK.AETHER_PORTAL;
  const onEnd = pf === BLOCK.END_PORTAL || pf2 === BLOCK.END_PORTAL;
  if ((onNether || onAether || onEnd) && portalCooldown <= 0) {
    portalTimer += dt;
    if (portalTimer > 1.0) {
      if (onEnd) { dimension === 'end' ? exitEnd() : enterEnd(); }
      else teleport(onAether ? 'aether' : 'nether');
    }
  } else if (!onNether && !onAether && !onEnd) {
    portalTimer = 0;
  }

  // day/night + lighting + crops + fluids
  updateDayNight(dt);
  growCrops(dt);
  growSaplings(dt);
  fluidTick(dt);
  // redstone buttons revert after their pulse
  if (rsButtons.length) {
    for (let i = rsButtons.length - 1; i >= 0; i--) {
      const b = rsButtons[i]; b.t -= dt;
      if (b.t <= 0) {
        if (world.getBlock(b.x, b.y, b.z) === BLOCK.BUTTON_ON) {
          world.setBlock(b.x, b.y, b.z, BLOCK.BUTTON);
          updateRedstone(world, b.x, b.y, b.z);
        }
        rsButtons.splice(i, 1);
      }
    }
  }

  // Create kinetics: run machines + spin the cogs/wheels
  if (kPositions.size) { kineticTick(world, dimension, dt); updateKineticVisuals(dt); }
  updatePlaceGhost();

  // hostile mobs spawn at night in the overworld; burn off at dawn
  if (dimension === 'overworld' && !peaceful && selectedWorld !== 'sandbox' && selectedWorld !== 'woolworld') {
    if (isNight()) {
      spawnTimer -= dt;
      const cap = isTouch ? 5 : 9;
      if (spawnTimer <= 0 && mobs.hostiles.length < cap) {
        mobs.spawnHostiles(player.pos.x, player.pos.z, 2);
        if (Math.random() < 0.22) mobs.spawnEnderman(player.pos.x, player.pos.z, 1);   // rare night enderman
        spawnTimer = 4 + Math.random() * 4;
      }
    } else if (mobs.hostiles.length) {
      mobs.clearHostiles();      // daylight clears the undead
    }
  }
  // nether: blazes patrol (drop blaze rods for eyes of ender)
  if (dimension === 'nether') {
    netherSpawnTimer -= dt;
    if (netherSpawnTimer <= 0 && mobs.hostiles.length < (isTouch ? 4 : 7)) {
      mobs.spawnBlazes(player.pos.x, player.pos.z, 2);
      netherSpawnTimer = 7 + Math.random() * 5;
    }
  }
  // end: endermen roam the island
  if (dimension === 'end' && !endFightWasActive) {
    netherSpawnTimer -= dt;
    if (netherSpawnTimer <= 0 && mobs.hostiles.length < (isTouch ? 3 : 5)) {
      mobs.spawnEnderman(player.pos.x, player.pos.z, 1);
      netherSpawnTimer = 6 + Math.random() * 6;
    }
  }

  world.update(player.pos.x, player.pos.z);
  drainLootChests();
  const contact = mobs.update(dt, player.pos);
  // boss bar + dragon-death detection
  updateBossBar();
  if (dimension === 'end' && endFightWasActive && !mobs.dragon && !endDragonDefeated) onDragonDefeated();
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
  if (spawnPoint && dimension === 'overworld') {
    player.pos.set(spawnPoint.x + 0.5, spawnPoint.y + 1, spawnPoint.z + 0.5);
  } else if (dimension === 'nether') {
    const sy = world.floorY(0, 0, 40);
    player.pos.set(0.5, sy, 0.5);
  } else if (dimension === 'aether') {
    player.pos.set(Math.floor(player.pos.x) + 0.5, 52, Math.floor(player.pos.z) + 0.5);
  } else if (dimension === 'end') {
    world.preload(0.5, 40.5);
    const sy = world.surfaceY(0, 40);
    player.pos.set(0.5, sy + 0.1, 40.5);
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
