// Create-style kinetics: a rotational-power network plus processing machines
// (millstone, mechanical press, encased fan) and spinning visual overlays.
//
// Globals from earlier scripts: THREE, BLOCK, BLOCK_INFO, ITEM, World.
// The model is intentionally forgiving: any two face-adjacent kinetic blocks
// share rotation, large<->small cogwheels change the ratio, and machines run
// whenever the network reaching them is turning.

// ---- block classification ----
const K_SOURCE = new Set([BLOCK.WATER_WHEEL, BLOCK.HAND_CRANK]);
const K_MACHINE = new Set([BLOCK.MILLSTONE, BLOCK.MECHANICAL_PRESS, BLOCK.ENCASED_FAN]);
const K_TRANSMIT = new Set([BLOCK.SHAFT, BLOCK.COGWHEEL, BLOCK.LARGE_COGWHEEL, BLOCK.GEARBOX]);
const K_ALL = new Set([...K_SOURCE, ...K_MACHINE, ...K_TRANSMIT]);
function isKinetic(id) { return K_ALL.has(id); }
function isMachine(id) { return K_MACHINE.has(id); }

const K_NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---- network state (for the current world) ----
const kPositions = new Set();           // "x,y,z" of every kinetic block
const kSpeed = new Map();               // "x,y,z" -> signed rotation speed
const handCrankSpin = new Map();         // "x,y,z" -> seconds of remaining spin
function kKey(x, y, z) { return x + ',' + y + ',' + z; }

function registerKinetic(x, y, z) { kPositions.add(kKey(x, y, z)); }
function unregisterKinetic(x, y, z) { kPositions.delete(kKey(x, y, z)); handCrankSpin.delete(kKey(x, y, z)); }

// Rebuild kPositions by scanning a world's post-generation edits.
function scanKinetics(world) {
  kPositions.clear(); kSpeed.clear(); _lastSourceSig = '';
  if (!world || !world.edits) return;
  for (const [k, id] of world.edits) if (isKinetic(id)) kPositions.add(k);
}

function _waterAdjacent(world, x, y, z) {
  for (const [dx, dy, dz] of K_NB6) if (world.getBlock(x + dx, y + dy, z + dz) === BLOCK.WATER) return true;
  return false;
}

// Flood rotation out from every source; large<->small cog meshes change ratio.
function recomputeKinetics(world) {
  kSpeed.clear();
  const queue = [];
  for (const key of kPositions) {
    const p = key.split(',');
    const x = +p[0], y = +p[1], z = +p[2];
    const id = world.getBlock(x, y, z);
    let s = 0;
    if (id === BLOCK.WATER_WHEEL && _waterAdjacent(world, x, y, z)) s = 8;
    else if (id === BLOCK.HAND_CRANK && (handCrankSpin.get(key) || 0) > 0) s = 16;
    if (s) { kSpeed.set(key, s); queue.push(key); }
  }
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const sp = kSpeed.get(key);
    const p = key.split(','); const x = +p[0], y = +p[1], z = +p[2];
    const id = world.getBlock(x, y, z);
    for (const [dx, dy, dz] of K_NB6) {
      const nk = kKey(x + dx, y + dy, z + dz);
      if (!kPositions.has(nk) || kSpeed.has(nk)) continue;
      const nid = world.getBlock(x + dx, y + dy, z + dz);
      let ns = sp;
      if (id === BLOCK.LARGE_COGWHEEL && nid === BLOCK.COGWHEEL) ns = sp * 2;       // big drives small faster
      else if (id === BLOCK.COGWHEEL && nid === BLOCK.LARGE_COGWHEEL) ns = sp / 2;  // small drives big slower
      kSpeed.set(nk, ns); queue.push(nk);
    }
  }
}

// ---- processing recipes ----
const MILL_RECIPES = {
  [BLOCK.IRON_ORE]: ITEM.CRUSHED_IRON, [BLOCK.GOLD_ORE]: ITEM.CRUSHED_GOLD,
  [ITEM.WHEAT]: ITEM.WHEAT_FLOUR, [BLOCK.COBBLE]: BLOCK.GRAVEL, [BLOCK.GRAVEL]: BLOCK.SAND,
};
const PRESS_RECIPES = { [ITEM.IRON_INGOT]: ITEM.IRON_SHEET, [ITEM.BRASS_INGOT]: ITEM.BRASS_SHEET };
const FAN_SMELT = {
  [BLOCK.IRON_ORE]: ITEM.IRON_INGOT, [BLOCK.GOLD_ORE]: ITEM.GOLD_INGOT,
  [ITEM.CRUSHED_IRON]: ITEM.IRON_INGOT, [ITEM.CRUSHED_GOLD]: ITEM.GOLD_INGOT,
  [BLOCK.SAND]: BLOCK.GLASS, [BLOCK.COBBLE]: BLOCK.STONE, [ITEM.DOUGH]: ITEM.BREAD,
};
const FAN_WASH = { [ITEM.CRUSHED_IRON]: ITEM.IRON_INGOT, [ITEM.CRUSHED_GOLD]: ITEM.GOLD_INGOT };
const MACHINE_TIME = { [BLOCK.MILLSTONE]: 3.0, [BLOCK.MECHANICAL_PRESS]: 2.0, [BLOCK.ENCASED_FAN]: 2.5 };

// What is the fan currently set up to do? (lava in front -> smelt, water -> wash)
function _fanMode(world, x, y, z) {
  for (const [dx, dy, dz] of K_NB6) { const b = world.getBlock(x + dx, y + dy, z + dz); if (b === BLOCK.LAVA) return FAN_SMELT; }
  for (const [dx, dy, dz] of K_NB6) { const b = world.getBlock(x + dx, y + dy, z + dz); if (b === BLOCK.WATER) return FAN_WASH; }
  return null;
}
function machineOutputFor(world, x, y, z, type, item) {
  if (type === BLOCK.MILLSTONE) return MILL_RECIPES[item] ?? null;
  if (type === BLOCK.MECHANICAL_PRESS) return PRESS_RECIPES[item] ?? null;
  if (type === BLOCK.ENCASED_FAN) { const m = _fanMode(world, x, y, z); return m ? (m[item] ?? null) : null; }
  return null;
}

// ---- machine inventories (keyed "dim|x,y,z") ----
const machineState = new Map();          // -> { item, n, prog, outId, outN }
function mKey(dim, x, y, z) { return dim + '|' + x + ',' + y + ',' + z; }
function getMachine(dim, x, y, z) {
  const k = mKey(dim, x, y, z);
  let m = machineState.get(k);
  if (!m) { m = { item: 0, n: 0, prog: 0, outId: 0, outN: 0 }; machineState.set(k, m); }
  return m;
}
// Try to insert one of `item` into the machine. Returns true if accepted.
function machineInsert(world, dim, x, y, z, type, item) {
  if (machineOutputFor(world, x, y, z, type, item) == null) return false;   // not a valid input here
  const m = getMachine(dim, x, y, z);
  if (m.n > 0 && m.item !== item) return false;                            // busy with another item
  if (m.n >= 64) return false;
  m.item = item; m.n++;
  return true;
}
// Collect finished output. Returns {id,n} or null.
function machineCollect(dim, x, y, z) {
  const m = machineState.get(mKey(dim, x, y, z));
  if (!m || m.outN <= 0) return null;
  const out = { id: m.outId, n: m.outN };
  m.outN = 0; m.outId = 0;
  return out;
}
// Everything a broken machine should drop.
function machineDump(dim, x, y, z) {
  const k = mKey(dim, x, y, z);
  const m = machineState.get(k);
  if (!m) return [];
  const drops = [];
  if (m.n > 0 && m.item) drops.push({ id: m.item, n: m.n });
  if (m.outN > 0 && m.outId) drops.push({ id: m.outId, n: m.outN });
  machineState.delete(k);
  return drops;
}

// Advance the crank timers + run every powered machine for dt seconds.
let _lastSourceSig = '';
function kineticTick(world, dim, dt) {
  // hand cranks wind down; recompute the network when one stops
  if (handCrankSpin.size) {
    let changed = false;
    for (const [key, t] of handCrankSpin) {
      const nt = t - dt;
      if (nt <= 0) { handCrankSpin.delete(key); changed = true; }
      else handCrankSpin.set(key, nt);
    }
    if (changed) { recomputeKinetics(world); _lastSourceSig = ''; }
  }
  // water wheels switch on/off as water appears/disappears beside them
  if (kPositions.size) {
    let sig = '';
    for (const key of kPositions) {
      const p = key.split(',');
      if (world.getBlock(+p[0], +p[1], +p[2]) === BLOCK.WATER_WHEEL && _waterAdjacent(world, +p[0], +p[1], +p[2])) sig += key + '|';
    }
    if (sig !== _lastSourceSig) { _lastSourceSig = sig; recomputeKinetics(world); }
  }
  // processing
  for (const key of kPositions) {
    const p = key.split(','); const x = +p[0], y = +p[1], z = +p[2];
    const type = world.getBlock(x, y, z);
    if (!isMachine(type)) continue;
    const speed = Math.abs(kSpeed.get(key) || 0);
    if (speed <= 0) continue;
    const m = machineState.get(mKey(dim, x, y, z));
    if (!m || m.n <= 0) continue;
    const outId = machineOutputFor(world, x, y, z, type, m.item);
    if (outId == null) continue;
    if (m.outN > 0 && m.outId !== outId) continue;                          // output buffer holds something else
    m.prog += dt;
    const need = MACHINE_TIME[type] * 8 / speed;
    if (m.prog >= need) {
      m.prog = 0; m.n--;
      m.outId = outId; m.outN = Math.min(99, m.outN + 1);
      if (m.n <= 0) m.item = 0;
    }
  }
}

// ===================== visuals (spinning overlays) =====================
let kVisuals = new Map();                 // "x,y,z" -> { group, axis, rot, kind }
let _kScene = null;
function _mat(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }
const _MAT = {
  metal: 0x9a9d9c, dark: 0x5f6261, brass: 0xcba74e, wood: 0x9a6a3a, stone: 0x7c7f7e,
};

function _gearGroup(R, thick, color) {
  const g = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.85, thick, 12), _mat(color));
  hub.rotation.x = Math.PI / 2; g.add(hub);
  const teeth = Math.max(6, Math.round(R * 14));
  const tg = new THREE.BoxGeometry(R * 0.32, R * 0.32, thick * 1.1), tm = _mat(color);
  for (let i = 0; i < teeth; i++) {
    const a = i / teeth * Math.PI * 2;
    const t = new THREE.Mesh(tg, tm);
    t.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    t.rotation.z = a; g.add(t);
  }
  return g;
}
function _shaftGroup() {
  const g = new THREE.Group();
  // a long thin rod that pokes out both ends of the block so the spin reads
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 8), _mat(_MAT.metal));
  g.add(s);
  const key = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.3, 0.34), _mat(_MAT.dark));
  g.add(key);
  return g;
}
function _wheelGroup() {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.09, 6, 18), _mat(_MAT.wood));
  g.add(rim);
  const pg = new THREE.BoxGeometry(0.16, 0.34, 0.26), pm = _mat(0x7a5230);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const p = new THREE.Mesh(pg, pm); p.position.set(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0); p.rotation.z = a; g.add(p); }
  return g;
}
function _fanGroup() {
  const g = new THREE.Group();
  const bg = new THREE.BoxGeometry(1.05, 0.14, 0.05), bm = _mat(_MAT.dark);
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const b = new THREE.Mesh(bg, bm); b.rotation.z = a; g.add(b); }
  return g;
}
function _crankGroup() {
  const g = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1), _mat(_MAT.brass)); arm.position.x = 0.12; g.add(arm);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 6), _mat(_MAT.wood)); handle.position.set(0.34, 0, 0); g.add(handle);
  return g;
}
function _millTop() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 10), _mat(_MAT.dark)); s.position.y = 0.42; g.add(s);
  return g;
}

// Build the overlay for one kinetic block. Returns {group, axis, kind} or null.
function _visualFor(id) {
  if (id === BLOCK.COGWHEEL) return { group: _gearGroup(0.6, 0.34, _MAT.metal), axis: 'z', kind: 'spin' };
  if (id === BLOCK.LARGE_COGWHEEL) return { group: _gearGroup(0.84, 0.34, _MAT.metal), axis: 'z', kind: 'spin' };
  if (id === BLOCK.SHAFT) return { group: _shaftGroup(), axis: 'y', kind: 'spin' };
  if (id === BLOCK.WATER_WHEEL) return { group: _wheelGroup(), axis: 'z', kind: 'spin' };
  if (id === BLOCK.HAND_CRANK) return { group: _crankGroup(), axis: 'y', kind: 'spin' };
  if (id === BLOCK.ENCASED_FAN) return { group: _fanGroup(), axis: 'z', kind: 'spin' };
  if (id === BLOCK.MILLSTONE) return { group: _millTop(), axis: 'y', kind: 'spin' };
  if (id === BLOCK.MECHANICAL_PRESS) return { group: _pressGroup(), axis: 'y', kind: 'press' };
  return null;
}
function _pressGroup() {
  const g = new THREE.Group();
  const ram = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.6), _mat(_MAT.brass));
  ram.position.y = 0.3; g.add(ram);
  g._ram = ram;
  return g;
}

function clearKineticVisuals(scene) {
  for (const v of kVisuals.values()) scene.remove(v.group);
  kVisuals = new Map();
}
function rebuildKineticVisuals(world, scene) {
  _kScene = scene;
  clearKineticVisuals(scene);
  for (const key of kPositions) {
    const p = key.split(','); const x = +p[0], y = +p[1], z = +p[2];
    const id = world.getBlock(x, y, z);
    const v = _visualFor(id);
    if (!v) continue;
    v.group.position.set(x + 0.5, y + 0.5, z + 0.5);
    scene.add(v.group);
    v.rot = 0; v.id = id;
    kVisuals.set(key, v);
  }
}
function updateKineticVisuals(dt) {
  for (const [key, v] of kVisuals) {
    const sp = kSpeed.get(key) || 0;
    if (v.kind === 'press') {
      // ram stamps down while the press is turning, rests up otherwise
      if (sp) { v.rot += dt * 3; v.group._ram.position.y = 0.06 + 0.22 * (0.5 + 0.5 * Math.sin(v.rot)); }
      else v.group._ram.position.y = 0.3;
      continue;
    }
    if (!sp) continue;
    v.rot += sp * dt * 0.35;
    v.group.rotation[v.axis] = v.rot;
  }
}
