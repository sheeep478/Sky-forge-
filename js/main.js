// SkyForge — entry point. Wires the menu, renderer, world, player, mobs,
// input (desktop + touch), HUD and survival systems together.

import * as THREE from 'three';
import { World, CHUNK } from './world.js';
import { Player } from './player.js';
import { MobManager } from './mobs.js';
import { BLOCK, BLOCK_INFO, PALETTE } from './blocks.js';
import { hashSeed } from './noise.js';

// Mark a successful engine boot so index.html's fallback banner stays hidden.
window.__skyforgeBooted = true;

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
  ? 'Touch device: use the on-screen joystick and buttons.'
  : 'Desktop: click to lock mouse · WASD move · Space jump · 1-9 blocks';

$('play-btn').addEventListener('click', startGame);

// ---------------- game state ----------------
let renderer, scene, camera, world, player, mobs, sun;
let running = false, paused = false;
let lastTime = 0;
let hotbarIndex = 0;
const input = { mx: 0, mz: 0, jump: false, sprint: false, up: false, down: false };

// survival stats
let health = 20, hunger = 20, hungerTimer = 0, regenTimer = 0;

function startGame() {
  menuEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');

  const seedStr = $('seed-input').value.trim() || ('sf' + Math.floor(Math.random() * 1e9));
  const seed = hashSeed(seedStr);

  // let the loading frame paint before heavy work
  setTimeout(() => initWorld(seed), 30);
}

function initWorld(seed) {
  if (!renderer) setupRenderer();

  // reset scene contents
  if (world) { for (const [, ch] of world.chunks) { if (ch.mesh) scene.remove(ch.mesh); if (ch.tmesh) scene.remove(ch.tmesh); } }
  if (mobs) mobs.clear();

  scene.clear();
  addLights();

  world = new World(scene, seed, selectedWorld);
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
  if (selectedWorld !== 'skyblock') mobs.spawnInitial(sx, sz, isTouch ? 5 : 8, 16);
  else mobs.spawnInitial(sx, sz, 3, 3);   // keep animals on the tiny island

  // reset survival
  health = 20; hunger = 20;
  buildHotbar();
  buildInventory();
  updateStats();
  setupInventoryCounts();

  loadingEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  $('mode-indicator').textContent =
    (selectedMode === 'creative' ? 'Creative' : 'Survival') + ' · ' + selectedWorld;
  $('stats').style.display = selectedMode === 'survival' ? 'flex' : 'none';

  if (isTouch) touchEl.classList.remove('hidden');

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
  scene.background = new THREE.Color(0x8fc7ee);
  scene.fog = new THREE.Fog(0x8fc7ee, CHUNK * 2.5, CHUNK * (isTouch ? 3.2 : 4.2));
  const amb = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(amb);
  sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);
}

// ---------------- HUD ----------------
function buildHotbar() {
  const hb = $('hotbar');
  hb.innerHTML = '';
  PALETTE.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === hotbarIndex ? ' active' : '');
    slot.innerHTML =
      `<span class="name">${BLOCK_INFO[id].name}</span>` +
      `<div class="swatch" style="background:${BLOCK_INFO[id].color}"></div>` +
      `<span class="count" data-count="${id}"></span>`;
    slot.addEventListener('click', () => selectHotbar(i));
    hb.appendChild(slot);
  });
  refreshCounts();
}

function selectHotbar(i) {
  hotbarIndex = (i + PALETTE.length) % PALETTE.length;
  $('hotbar').querySelectorAll('.slot').forEach((s, idx) =>
    s.classList.toggle('active', idx === hotbarIndex));
}

// inventory counts (survival)
const inventory = {};
function setupInventoryCounts() {
  for (const id of PALETTE) inventory[id] = selectedMode === 'creative' ? Infinity : 0;
  // give a small starter kit in survival
  if (selectedMode === 'survival') {
    inventory[BLOCK.DIRT] = 16; inventory[BLOCK.WOOD] = 8; inventory[BLOCK.STONE] = 8;
  }
  refreshCounts();
}
function refreshCounts() {
  document.querySelectorAll('.count').forEach((el) => {
    const id = +el.dataset.count;
    const c = inventory[id];
    el.textContent = (c === Infinity || c === undefined) ? '' : (c > 0 ? c : '');
  });
}

function buildInventory() {
  const grid = $('inventory-grid');
  grid.innerHTML = '';
  PALETTE.forEach((id, i) => {
    const it = document.createElement('div');
    it.className = 'inv-item';
    it.innerHTML = `<div class="swatch" style="background:${BLOCK_INFO[id].color}"></div>${BLOCK_INFO[id].name}`;
    it.addEventListener('click', () => { selectHotbar(i); });
    grid.appendChild(it);
  });
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
    if (e.code.startsWith('Digit')) {
      const n = +e.code.slice(5);
      if (n >= 1 && n <= PALETTE.length) selectHotbar(n - 1);
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
  // desktop break / place
  canvas.addEventListener('mousedown', (e) => {
    if (isTouch || !running || paused) return;
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) breakBlock();
    else if (e.button === 2) placeBlock();
  });
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
function setupTouch() {
  const joy = $('joystick'), knob = $('joystick-knob');
  let joyId = null, jcx = 0, jcy = 0;
  const R = 50;

  const startJoy = (t) => {
    joyId = t.identifier;
    const r = joy.getBoundingClientRect();
    jcx = r.left + r.width / 2; jcy = r.top + r.height / 2;
  };
  const moveJoy = (t) => {
    let dx = t.clientX - jcx, dy = t.clientY - jcy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.mx = dx / R; input.mz = dy / R;
    input.sprint = d > R * 0.8;
  };
  const endJoy = () => {
    joyId = null; knob.style.transform = 'translate(0,0)';
    input.mx = 0; input.mz = 0; input.sprint = false;
  };

  joy.addEventListener('touchstart', (e) => {
    e.preventDefault(); startJoy(e.changedTouches[0]); moveJoy(e.changedTouches[0]);
  }, { passive: false });

  // global touch handling for look (right side) + joystick tracking
  let lookId = null, lastLX = 0, lastLY = 0;
  window.addEventListener('touchstart', (e) => {
    if (!running || paused) return;
    for (const t of e.changedTouches) {
      if (joyId === null && isInside(joy, t)) { startJoy(t); moveJoy(t); continue; }
      if (lookId === null && t.clientX > window.innerWidth * 0.4 && !isOnButton(t)) {
        lookId = t.identifier; lastLX = t.clientX; lastLY = t.clientY;
      }
    }
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!running || paused) return;
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { e.preventDefault(); moveJoy(t); }
      else if (t.identifier === lookId && player) {
        player.look((t.clientX - lastLX) * 1.6, (t.clientY - lastLY) * 1.6);
        lastLX = t.clientX; lastLY = t.clientY;
      }
    }
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) endJoy();
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
  $('btn-break').addEventListener('touchstart', (e) => { e.preventDefault(); breakBlock(); }, { passive: false });
}
function isInside(el, t) {
  const r = el.getBoundingClientRect();
  return t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
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

function breakBlock() {
  if (!running || paused) return;
  const hit = raycast();
  if (!hit) return;
  const info = BLOCK_INFO[hit.block];
  if (info.unbreakable) return;
  world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
  // collect into inventory (survival), skip water
  if (selectedMode === 'survival' && !info.liquid && PALETTE.includes(hit.block)) {
    inventory[hit.block] = (inventory[hit.block] || 0) + 1;
    refreshCounts();
  }
}

function placeBlock() {
  if (!running || paused) return;
  const hit = raycast();
  if (!hit) return;
  const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
  const id = PALETTE[hotbarIndex];
  // inventory check
  if (selectedMode === 'survival') {
    if (!inventory[id] || inventory[id] <= 0) return;
  }
  // don't place inside the player's body
  if (overlapsPlayer(px, py, pz)) return;
  if (world.getBlock(px, py, pz) !== BLOCK.AIR) return;
  world.setBlock(px, py, pz, id);
  if (selectedMode === 'survival' && inventory[id] !== Infinity) {
    inventory[id]--; refreshCounts();
  }
}

function overlapsPlayer(bx, by, bz) {
  const p = player.pos;
  const minX = p.x - 0.3, maxX = p.x + 0.3, minZ = p.z - 0.3, maxZ = p.z + 0.3;
  const minY = p.y, maxY = p.y + 1.8;
  return bx + 1 > minX && bx < maxX && bz + 1 > minZ && bz < maxZ && by + 1 > minY && by < maxY;
}

// ---------------- pause / quit ----------------
function togglePause() {
  if (!running) return;
  paused = !paused;
  pauseEl.classList.toggle('hidden', !paused);
  if (paused && document.pointerLockElement) document.exitPointerLock();
  if (!paused) lastTime = performance.now();
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
  }

  world.update(player.pos.x, player.pos.z);
  mobs.update(dt);

  // keep sun/fog centered (cheap day feel)
  renderer.render(scene, camera);
}

function respawn() {
  let sx = 0.5, sz = 0.5;
  if (selectedWorld === 'skyblock') { sx = 8.5; sz = 8.5; }
  const sy = world.surfaceY(Math.floor(sx), Math.floor(sz));
  player.pos.set(sx, sy + 1, sz);
  player.vel.set(0, 0, 0);
  health = 20; hunger = 20; updateStats();
}
