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
const kFacing = new Map();               // "x,y,z" -> 'x' | 'y' | 'z' (rotation axis)
const handCrankSpin = new Map();         // "x,y,z" -> seconds of remaining spin
function kKey(x, y, z) { return x + ',' + y + ',' + z; }

function registerKinetic(x, y, z) { kPositions.add(kKey(x, y, z)); }
function unregisterKinetic(x, y, z) { const k = kKey(x, y, z); kPositions.delete(k); handCrankSpin.delete(k); kFacing.delete(k); }
function setKineticAxis(x, y, z, axis) { kFacing.set(kKey(x, y, z), axis); }
function loadKineticFacing(arr) { if (arr) for (const [k, a] of arr) kFacing.set(k, a); }
function clearKineticFacing() { kFacing.clear(); }

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

// ===================== visuals (real 3D models, Create-style) =====================
// Shafts, cogwheels, large cogwheels, water wheels and hand cranks are NOT drawn
// in the chunk mesh (MODEL_BLOCKS); they appear purely as these models. Machines
// (millstone/press/fan) keep their cube and add a moving part on top.
let kVisuals = new Map();                 // "x,y,z" -> { group, spin, axis, rot, kind }
function _mat(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }
const _MAT = { metal: 0x8b8e8d, dark: 0x55585a, light: 0xa6a9a8, brass: 0xcba74e, wood: 0x9a6a3a, woodDark: 0x6e4a28, stone: 0x6f7271 };

// A shaft: a plus/cross-section rod along local Z (so it tiles end-to-end).
function _shaftBars(len) {
  const g = new THREE.Group();
  const m = _mat(_MAT.metal), d = _mat(_MAT.dark);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, len), m));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, len), m));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len + 0.01), d));   // dark core groove
  return g;
}
function _shaftModel() { return _shaftBars(1.0); }

// A thin toothed cogwheel in the local XY plane (spins around local Z), with a
// shaft passing through it.
function _cogModel(R, teeth) {
  const g = new THREE.Group();
  const m = _mat(_MAT.metal), d = _mat(_MAT.dark), l = _mat(_MAT.light);
  const depth = 0.22;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.72, R * 0.72, depth, 16), m);
  hub.rotation.x = Math.PI / 2; g.add(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.82, depth * 0.28, 6, 24), l); g.add(ring);
  const tg = new THREE.BoxGeometry(R * 0.34, R * 0.34, depth * 1.05);
  for (let i = 0; i < teeth; i++) {
    const a = i / teeth * Math.PI * 2;
    const t = new THREE.Mesh(tg, m);
    t.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); t.rotation.z = a; g.add(t);
  }
  g.add(_shaftBars(1.0));                 // shaft through the hub
  return g;
}

// A wooden water wheel (spins around local Z).
function _wheelModel() {
  const g = new THREE.Group();
  const R = 0.82;
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 6, 22), _mat(_MAT.wood)));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(R * 0.62, 0.05, 6, 20), _mat(_MAT.woodDark)));
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const s = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.1, 0.14), _mat(_MAT.woodDark)); s.rotation.z = a; g.add(s); }
  const pg = new THREE.BoxGeometry(0.26, 0.34, 0.4);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const p = new THREE.Mesh(pg, _mat(0x7a5230)); p.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); p.rotation.z = a; g.add(p); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 8), _mat(_MAT.metal)); hub.rotation.x = Math.PI / 2; g.add(hub);
  return g;
}

// A brass hand crank on a short shaft (spins around local Z, mounted into -Z).
function _crankModel() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 10), _mat(_MAT.metal));
  base.rotation.x = Math.PI / 2; base.position.z = -0.18; g.add(base);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.12), _mat(_MAT.brass)); arm.position.set(0.16, 0, 0.22); g.add(arm);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 6), _mat(_MAT.wood)); handle.position.set(0.36, 0, 0.22); g.add(handle);
  return g;
}

// Machine moving parts (added on top of the rendered cube).
function _millTop() { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.18, 12), _mat(_MAT.dark)); s.position.y = 0.42; g.add(s); return g; }
function _fanBlades() { const g = new THREE.Group(); const bg = new THREE.BoxGeometry(0.9, 0.14, 0.05); for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; const b = new THREE.Mesh(bg, _mat(_MAT.dark)); b.rotation.z = a; g.add(b); } return g; }
function _pressRam() { const g = new THREE.Group(); const ram = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), _mat(_MAT.brass)); ram.position.y = 0.32; g.add(ram); g._ram = ram; return g; }

// Returns {build, oriented, axisFixed, kind} for a kinetic id, or null.
function _modelDef(id) {
  switch (id) {
    case BLOCK.SHAFT: return { build: _shaftModel, oriented: true, def: 'y' };
    case BLOCK.COGWHEEL: return { build: () => _cogModel(0.46, 8), oriented: true, def: 'z' };
    case BLOCK.LARGE_COGWHEEL: return { build: () => _cogModel(0.66, 12), oriented: true, def: 'z' };
    case BLOCK.WATER_WHEEL: return { build: _wheelModel, oriented: true, def: 'z' };
    case BLOCK.HAND_CRANK: return { build: _crankModel, oriented: true, def: 'y' };
    case BLOCK.ENCASED_FAN: return { build: _fanBlades, oriented: true, def: 'z' };
    case BLOCK.MILLSTONE: return { build: _millTop, axisFixed: 'y' };
    case BLOCK.MECHANICAL_PRESS: return { build: _pressRam, kind: 'press' };
    default: return null;
  }
}
function _orient(group, axis) {                 // point the model's local +Z along world `axis`
  if (axis === 'x') group.rotation.y = Math.PI / 2;
  else if (axis === 'y') group.rotation.x = -Math.PI / 2;
}

function clearKineticVisuals(scene) {
  for (const v of kVisuals.values()) scene.remove(v.group);
  kVisuals = new Map();
}
function rebuildKineticVisuals(world, scene) {
  clearKineticVisuals(scene);
  for (const key of kPositions) {
    const p = key.split(','); const x = +p[0], y = +p[1], z = +p[2];
    const def = _modelDef(world.getBlock(x, y, z));
    if (!def) continue;
    const inner = def.build();
    let group, spin, axis;
    if (def.oriented) {                         // model blocks: outer orients, inner spins on local Z
      group = new THREE.Group(); group.add(inner);
      _orient(group, kFacing.get(key) || def.def);
      spin = inner; axis = 'z';
    } else {                                     // machine parts: spin straight around a world axis
      group = inner; spin = inner; axis = def.axisFixed || 'y';
    }
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    scene.add(group);
    kVisuals.set(key, { group, spin, axis, rot: 0, kind: def.kind || 'spin' });
  }
}
function updateKineticVisuals(dt) {
  for (const [key, v] of kVisuals) {
    const sp = kSpeed.get(key) || 0;
    if (v.kind === 'press') {
      if (sp) { v.rot += dt * 3; v.spin._ram.position.y = 0.08 + 0.22 * (0.5 + 0.5 * Math.sin(v.rot)); }
      else v.spin._ram.position.y = 0.32;
      continue;
    }
    if (!sp) continue;
    v.rot += sp * dt * 0.4;
    v.spin.rotation[v.axis] = v.rot;
  }
}
