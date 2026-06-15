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
let portalCooldown = 0, portalTimer = 0, returnPos = null;

// mining (hold-to-break) state
let miningActive = false, miningTarget = null, miningProgress = 0, miningNeeded = 1;

function startGame() {
  // Engine (Three.js) must be loaded by the CDN bridge first.
  if (typeof THREE === 'undefined' || !window.THREE) {
    document.getElementById('cdn-error').classList.remove('hidden');
    return;
  }
  menuEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  const seedStr = $('seed-input').value.trim() || ('sf' + Math.floor(Math.random() * 1e9));
  const seed = hashSeed(seedStr);

  // let the loading frame paint before heavy work
  setTimeout(() => initWorld(seed), 30);
}

function initWorld(seed) {
  if (!renderer) setupRenderer();

  // reset scene contents (both dimensions)
  if (overworld) overworld.hide();
  if (netherWorld) netherWorld.hide();
  if (overworldMobs) overworldMobs.clear();
  if (netherMobs) netherMobs.clear();
  netherWorld = null; netherMobs = null;
  dimension = 'overworld'; portalCooldown = 0; portalTimer = 0; returnPos = null;

  scene.clear();
  gameSeed = seed >>> 0;
  addLights();

  world = new World(scene, seed, selectedWorld);
  overworld = world;
  if (isTouch) world.renderDistance = 3;   // lighter for mobile

  // spawn position
  let sx = 0.5, sz = 0.5;
  if (selectedWorld === 'skyblock') { sx = 8.5; sz = 8.5; }
  world.preload(sx, sz);
  const sy = world.surfaceY(Math.floor(sx), Math.floor(sz));

  camera.position.set(sx, sy + 2, sz);
  player = new Player(camera, world);
  player.pos.set(sx, sy + 1, sz);
  player.setMode(selectedMode === 'creative');

  mobs = new MobManager(world, scene);
  overworldMobs = mobs;
  if (selectedWorld !== 'skyblock') mobs.spawnInitial(sx, sz, isTouch ? 5 : 8, 16);
  else mobs.spawnInitial(sx, sz, 3, 3);   // keep animals on the tiny island

  // reset survival + inventory
  health = 20; hunger = 20; lavaTimer = 0;
  miningActive = false; miningTarget = null; miningProgress = 0;
  buildItemIcons();
  setupInventory();
  buildCrafting();
  updateStats();

  loadingEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' + selectedWorld;
  $('stats').style.display = selectedMode === 'survival' ? 'flex' : 'none';

  if (isTouch) {
    touchEl.classList.remove('hidden');
    const h = $('touch-hint');
    h.classList.remove('hidden'); h.style.opacity = '1';
    setTimeout(hideHint, 6000);
  }

  running = true; paused = false;
  lastTime = performance.now();
  requestAnimationFrame(loop);
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
  const amb = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(amb);
  sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);
  setDimensionVisuals();
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

const ALL_TOOLS = [ITEM.W_PICK, ITEM.W_AXE, ITEM.W_SHOVEL, ITEM.W_SWORD,
                   ITEM.S_PICK, ITEM.S_AXE, ITEM.S_SHOVEL, ITEM.S_SWORD];

function iconStyle(id) {
  const icon = itemIcon(id);
  const fallback = isBlockItem(id) && BLOCK_INFO[id] ? BLOCK_INFO[id].color : '#3a3f4b';
  const bg = icon ? `background-image:url('${icon}');background-size:cover;` : '';
  return `${bg}background-color:${fallback};`;
}

function setupInventory() {
  for (const k in inventory) delete inventory[k];
  if (selectedMode === 'creative') {
    for (const id of PALETTE) inventory[id] = Infinity;
    for (const id of ALL_TOOLS) inventory[id] = Infinity;
  } else {
    // friendly starter kit so mining isn't a slog
    inventory[BLOCK.WOOD] = 6;
    inventory[ITEM.W_PICK] = 1;
    inventory[ITEM.W_AXE] = 1;
  }
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
    hotbarItems = [...ALL_TOOLS, ...PALETTE];
  } else {
    const owned = Object.keys(inventory).map(Number).filter((id) => (inventory[id] || 0) > 0);
    owned.sort((a, b) => (isTool(b) - isTool(a)) || (a - b));  // tools first
    hotbarItems = owned;
  }
  if (hotbarItems.length === 0) hotbarItems = [BLOCK.DIRT];   // never empty
  let idx = prev != null ? hotbarItems.indexOf(prev) : -1;
  hotbarIndex = idx >= 0 ? idx : Math.min(hotbarIndex, hotbarItems.length - 1);
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
  const grid = $('inventory-grid');
  grid.innerHTML = '';
  const ids = selectedMode === 'creative'
    ? [...ALL_TOOLS, ...PALETTE]
    : Object.keys(inventory).map(Number).filter((id) => (inventory[id] || 0) > 0);
  if (ids.length === 0) { grid.innerHTML = '<p class="empty">Mine some blocks…</p>'; }
  ids.forEach((id) => {
    const c = inventory[id];
    const count = (c === Infinity || isTool(id)) ? '' : c;
    const it = document.createElement('div');
    it.className = 'inv-item';
    it.innerHTML = `<div class="swatch" style="${iconStyle(id)}"></div>` +
      `<span class="count">${count || ''}</span><span class="lbl">${itemName(id)}</span>`;
    it.addEventListener('click', () => { selectHotbarItem(id); togglePause(); });
    grid.appendChild(it);
  });
}
function selectHotbarItem(id) {
  const i = hotbarItems.indexOf(id);
  if (i >= 0) selectHotbar(i);
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
    if (e.code === 'Escape') togglePause();
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
      player.look(e.movementX, e.movementY);
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
  $('resume-btn').addEventListener('click', togglePause);
  $('quit-btn').addEventListener('click', quitToMenu);

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
  const R = 55, DEAD = 0.2, LOOK_SENS = 0.9;

  let moveId = null, moveOX = 0, moveOY = 0;
  let lookId = null, lastLX = 0, lastLY = 0;

  const showJoy = (x, y) => {
    joy.style.left = x + 'px'; joy.style.top = y + 'px';
    joy.classList.add('active');
    knob.style.transform = 'translate(0,0)';
  };
  const updateJoy = (x, y) => {
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
    if (!running || paused) return;
    hideHint();
    for (const t of e.changedTouches) {
      if (isOnButton(t)) continue;                         // buttons/hotbar self-handle
      if (moveId === null && t.clientX < window.innerWidth * 0.5) {
        moveId = t.identifier; moveOX = t.clientX; moveOY = t.clientY;
        showJoy(t.clientX, t.clientY); updateJoy(t.clientX, t.clientY);
        e.preventDefault();
      } else if (lookId === null) {
        lookId = t.identifier; lastLX = t.clientX; lastLY = t.clientY;
      }
    }
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!running || paused) return;
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { e.preventDefault(); updateJoy(t.clientX, t.clientY); }
      else if (t.identifier === lookId && player) {
        e.preventDefault();
        player.look((t.clientX - lastLX) * LOOK_SENS, (t.clientY - lastLY) * LOOK_SENS);
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
    if (b !== BLOCK.AIR && BLOCK_INFO[b] && BLOCK_INFO[b].solid) {
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
  if (!running || paused) return;
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
}
function doBreakSurvival(hit) {
  if (BLOCK_INFO[hit.block].unbreakable) return;
  const tool = activeTool();
  world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
  const drop = blockDrop(hit.block, tool);
  if (drop) give(drop.id, drop.n);
}

function placeBlock() {
  if (!running || paused) return;
  const item = activeItem();
  if (!isBlockItem(item) || !PALETTE.includes(item)) return;   // only placeable blocks
  if (selectedMode === 'survival' && !(inventory[item] > 0)) return;
  const hit = raycast();
  if (!hit) return;
  const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
  // orient logs along the axis of the clicked face
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
    if (!netherWorld) {
      netherWorld = new World(scene, (gameSeed ^ 0x9e3779b9) >>> 0, 'nether');
      if (isTouch) netherWorld.renderDistance = 3;
      netherMobs = new MobManager(netherWorld, scene);
    }
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
  paused = !paused;
  pauseEl.classList.toggle('hidden', !paused);
  if (paused) {
    onBreakRelease();                 // stop mining while in the menu
    buildInventory(); refreshCrafting();
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    lastTime = performance.now();
  }
}
function quitToMenu() {
  running = false; paused = false;
  pauseEl.classList.add('hidden');
  hudEl.classList.add('hidden');
  touchEl.classList.add('hidden');
  menuEl.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

// ---------------- main loop ----------------
function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (paused) return;

  if (!isTouch) readKeyboard();

  const prevVy = player.vel.y;
  const wasGround = player.onGround;
  player.update(dt, input);

  // fall damage in survival
  if (selectedMode === 'survival' && !wasGround && player.onGround) {
    const impact = -prevVy;
    if (impact > 14) {
      health -= Math.floor((impact - 14) * 1.4);
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

  world.update(player.pos.x, player.pos.z);
  mobs.update(dt);

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
}
