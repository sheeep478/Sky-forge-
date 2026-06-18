// Passive mobs: Pig, Cow, Chicken. Boxy models + simple wander AI
// that follows the ground surface and avoids walking off into walls.

// THREE is a global provided by the engine bridge.

function mat(hex) { return new THREE.MeshLambertMaterial({ color: hex }); }
function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

// ---- model builders (origin at feet, facing -Z) ----
function buildPig() {
  const g = new THREE.Group();
  const pink = mat(0xe89aa6), dark = mat(0xc77a86), nose = mat(0xd98793);
  const body = box(0.7, 0.5, 1.0, pink, 0, 0.55, 0); g.add(body);
  const head = box(0.5, 0.5, 0.45, pink, 0, 0.65, -0.65); g.add(head);
  g.add(box(0.22, 0.12, 0.1, nose, 0, 0.6, -0.9));
  const legs = [];
  for (const [x, z] of [[-0.22,-0.3],[0.22,-0.3],[-0.22,0.35],[0.22,0.35]]) {
    const l = box(0.2, 0.32, 0.2, dark, x, 0.16, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, head };
}
function buildCow() {
  const g = new THREE.Group();
  const brown = mat(0x6b4a30), white = mat(0xefe8df), pink = mat(0xd98793), horn = mat(0xd9cdb0);
  const body = box(0.8, 0.6, 1.2, brown, 0, 0.7, 0); g.add(body);
  g.add(box(0.5, 0.3, 0.7, white, 0.18, 0.7, 0.1));
  const head = box(0.55, 0.55, 0.5, brown, 0, 0.85, -0.8); g.add(head);
  g.add(box(0.4, 0.3, 0.1, white, 0, 0.75, -1.05));
  g.add(box(0.1, 0.18, 0.1, horn, -0.2, 1.15, -0.8));
  g.add(box(0.1, 0.18, 0.1, horn, 0.2, 1.15, -0.8));
  g.add(box(0.3, 0.15, 0.3, pink, 0, 0.4, 0.35)); // udder
  const legs = [];
  for (const [x, z] of [[-0.28,-0.4],[0.28,-0.4],[-0.28,0.45],[0.28,0.45]]) {
    const l = box(0.22, 0.42, 0.22, brown, x, 0.21, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, head };
}
function buildChicken() {
  const g = new THREE.Group();
  const white = mat(0xf4f4f2), beak = mat(0xe8a33a), red = mat(0xcf3b34), leg = mat(0xe8a33a);
  const body = box(0.4, 0.4, 0.5, white, 0, 0.5, 0); g.add(body);
  const head = box(0.3, 0.3, 0.3, white, 0, 0.78, -0.28); g.add(head);
  g.add(box(0.14, 0.1, 0.14, beak, 0, 0.76, -0.46));
  g.add(box(0.1, 0.12, 0.05, red, 0, 0.92, -0.28));   // comb
  g.add(box(0.08, 0.1, 0.05, red, 0, 0.66, -0.42));   // wattle
  g.add(box(0.12, 0.3, 0.4, white, 0.26, 0.5, 0));    // wing
  g.add(box(0.12, 0.3, 0.4, white, -0.26, 0.5, 0));
  const legs = [];
  for (const [x, z] of [[-0.1, 0],[0.1, 0]]) {
    const l = box(0.07, 0.3, 0.07, leg, x, 0.15, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, head };
}

function buildSheep() {
  return buildSheepModel(0xe8e8e8);
}
function buildSheepModel(bodyColor) {
  const g = new THREE.Group();
  const wool = mat(bodyColor), skin = mat(0xd8b9a6), leg = mat(0x6b5746);
  g.add(box(0.85, 0.7, 1.05, wool, 0, 0.75, 0));           // fluffy body
  const head = box(0.42, 0.42, 0.4, skin, 0, 0.7, -0.7); g.add(head);
  g.add(box(0.46, 0.5, 0.2, wool, 0, 0.85, -0.55));        // wool on forehead
  const legs = [];
  for (const [x, z] of [[-0.28,-0.35],[0.28,-0.35],[-0.28,0.4],[0.28,0.4]]) {
    const l = box(0.2, 0.4, 0.2, leg, x, 0.2, z); g.add(l); legs.push(l);
  }
  return { group: g, legs, head };
}

// ore / resource sheep: a sheep whose wool is the resource, dropping it when killed
const ORE_SHEEP = {
  sheep_coal:     { color: 0x2a2a2e, drop: ITEM.COAL },
  sheep_iron:     { color: 0xd0d0d0, drop: ITEM.IRON_INGOT },
  sheep_gold:     { color: 0xf0c632, drop: ITEM.GOLD_INGOT },
  sheep_diamond:  { color: 0x4fe0d8, drop: ITEM.DIAMOND },
  sheep_redstone: { color: 0xb02a18, drop: BLOCK.REDSTONE_DUST },
};

const BUILDERS = {
  pig: buildPig, cow: buildCow, chicken: buildChicken, sheep: buildSheep,
};
for (const t in ORE_SHEEP) BUILDERS[t] = () => buildSheepModel(ORE_SHEEP[t].color);
const NAMES = ['pig', 'cow', 'chicken', 'sheep'];

class Mob {
  constructor(type, world, scene) {
    this.type = type;
    this.world = world;
    const built = BUILDERS[type]();
    this.obj = built.group;
    this.legs = built.legs;
    this.head = built.head;
    scene.add(this.obj);
    this.pos = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.vy = 0;
    this.walkTimer = 0;
    this.moving = false;
    this.anim = 0;
    this.speed = type === 'chicken' ? 1.6 : 1.2;
    this.hp = 10;
    this.dead = false;
    this.kbx = 0; this.kbz = 0;   // knockback velocity
    this.drop = ORE_SHEEP[type] ? { id: ORE_SHEEP[type].drop, n: 1 + (Math.random() * 2 | 0) }
      : type === 'cow' ? { id: ITEM.LEATHER, n: 1 }
      : type === 'pig' ? { id: ITEM.PORKCHOP, n: 1 }
      : type === 'sheep' ? { id: BLOCK.WOOL, n: 1 }
      : { id: ITEM.CHICKEN, n: 1 };
  }

  place(x, y, z) { this.pos.set(x, y, z); }

  takeHit(dmg, kx, kz) {
    this.hp -= dmg;
    this.kbx = kx * 6; this.kbz = kz * 6;
    this.vy = Math.max(this.vy, 4);
    if (this.hp <= 0) this.dead = true;
  }

  update(dt) {
    const w = this.world;
    const G = 22, MAXV = 40;

    // decide behaviour periodically
    this.walkTimer -= dt;
    if (this.walkTimer <= 0) {
      this.moving = Math.random() < 0.6;
      this.yaw = Math.random() * Math.PI * 2;
      this.walkTimer = 1.5 + Math.random() * 3;
    }

    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const feetL = Math.floor(this.pos.y + 0.0001);   // block level the feet rest at

    // find the ground directly beneath the feet (scan a few blocks down)
    let stand = -Infinity;
    for (let L = feetL; L >= feetL - 4; L--) {
      if (w.isSolid(bx, L - 1, bz)) { stand = L; break; }
    }

    // gravity — the mob falls whenever nothing is under it
    this.vy -= G * dt;
    if (this.vy < -MAXV) this.vy = -MAXV;
    let ny = this.pos.y + this.vy * dt;
    let onGround = false;
    if (stand !== -Infinity && ny <= stand) { ny = stand; this.vy = 0; onGround = true; }
    this.pos.y = ny;

    // wander horizontally, but don't walk into walls or off >1 block drops
    if (this.moving && onGround) {
      const nx = this.pos.x - Math.sin(this.yaw) * this.speed * dt;
      const nz = this.pos.z - Math.cos(this.yaw) * this.speed * dt;
      const tbx = Math.floor(nx), tbz = Math.floor(nz);
      const stepUp = w.isSolid(tbx, feetL, tbz);            // 1-high step in front
      const headBlocked = w.isSolid(tbx, feetL + (stepUp ? 2 : 1), tbz);
      // ground beneath the target within one block down?
      const groundAhead = w.isSolid(tbx, feetL - 1, tbz) || w.isSolid(tbx, feetL, tbz);
      if (!headBlocked && groundAhead) {
        this.pos.x = nx; this.pos.z = nz;
        if (stepUp) this.pos.y = feetL + 1;                 // climb the step
        this.anim += dt * 9;
      } else {
        this.yaw += Math.PI / 2;                            // turn away from wall/edge
      }
    }

    // knockback slide (from being hit)
    if (Math.abs(this.kbx) + Math.abs(this.kbz) > 0.05) {
      const nx = this.pos.x + this.kbx * dt, nz = this.pos.z + this.kbz * dt;
      if (!w.isSolid(Math.floor(nx), Math.floor(this.pos.y), Math.floor(nz))) { this.pos.x = nx; this.pos.z = nz; }
      const decay = Math.pow(0.0001, dt);
      this.kbx *= decay; this.kbz *= decay;
    }

    // if a mob somehow falls into the void, drop it back onto its column's surface
    if (this.pos.y < -25) {
      const surf = w.surfaceY(bx, bz);
      if (surf > 0) { this.pos.y = surf; this.vy = 0; }
    }

    // apply transform + leg swing
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
    const swing = (this.moving && onGround) ? Math.sin(this.anim) * 0.5 : 0;
    this.legs.forEach((l, i) => { l.rotation.x = swing * (i % 2 === 0 ? 1 : -1); });
  }

  dispose(scene) { scene.remove(this.obj); }
}

// ---- hostile: Zombie ----
function buildZombie() {
  const g = new THREE.Group();
  const skin = mat(0x4a7a3a), shirt = mat(0x3a5fa0), pants = mat(0x2a3a6a), face = mat(0x35602b);
  g.add(box(0.5, 0.5, 0.5, skin, 0, 1.55, 0));           // head
  g.add(box(0.16, 0.16, 0.05, face, -0.12, 1.6, -0.26)); // eyes
  g.add(box(0.16, 0.16, 0.05, face, 0.12, 1.6, -0.26));
  g.add(box(0.55, 0.7, 0.3, shirt, 0, 1.0, 0));          // body
  const arms = [];
  const la = box(0.18, 0.65, 0.18, skin, -0.37, 1.15, -0.18); g.add(la); arms.push(la);
  const ra = box(0.18, 0.65, 0.18, skin, 0.37, 1.15, -0.18); g.add(ra); arms.push(ra);
  const legs = [];
  for (const x of [-0.14, 0.14]) { const l = box(0.2, 0.65, 0.2, pants, x, 0.33, 0); g.add(l); legs.push(l); }
  return { group: g, legs, arms };
}

class Zombie {
  constructor(world, scene) {
    this.world = world;
    const built = buildZombie();
    this.obj = built.group; this.legs = built.legs; this.arms = built.arms;
    scene.add(this.obj);
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.vy = 0; this.anim = 0;
    this.hp = 20; this.dead = false;
    this.speed = 1.7; this.attackCD = 0;
    this.kbx = 0; this.kbz = 0;
    this.attacked = 0;          // damage to deal to the player this frame
  }
  place(x, y, z) { this.pos.set(x, y, z); }
  takeHit(dmg, kx, kz) {
    this.hp -= dmg; this.kbx = kx * 7; this.kbz = kz * 7;
    this.vy = Math.max(this.vy, 4);
    if (this.hp <= 0) this.dead = true;
  }

  update(dt, target) {
    const w = this.world;
    this.attacked = 0;
    this.attackCD -= dt;

    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const feetL = Math.floor(this.pos.y + 0.0001);
    let stand = -Infinity;
    for (let L = feetL; L >= feetL - 4; L--) if (w.isSolid(bx, L - 1, bz)) { stand = L; break; }

    this.vy -= 22 * dt; if (this.vy < -40) this.vy = -40;
    let ny = this.pos.y + this.vy * dt;
    let onGround = false;
    if (stand !== -Infinity && ny <= stand) { ny = stand; this.vy = 0; onGround = true; }
    this.pos.y = ny;

    // chase the player
    let dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.yaw = Math.atan2(-dx, -dz);
    if (onGround && dist > 1.1) {
      dx /= dist || 1; dz /= dist || 1;
      const nx = this.pos.x + dx * this.speed * dt, nz = this.pos.z + dz * this.speed * dt;
      const tbx = Math.floor(nx), tbz = Math.floor(nz);
      const stepUp = w.isSolid(tbx, feetL, tbz);
      const headBlocked = w.isSolid(tbx, feetL + (stepUp ? 2 : 1), tbz);
      if (!headBlocked) {
        this.pos.x = nx; this.pos.z = nz;
        if (stepUp && w.isSolid(tbx, feetL - 1, tbz)) this.pos.y = feetL + 1;
        this.anim += dt * 8;
      } else if (onGround) { this.vy = 7; }   // jump at a wall
    }

    // attack on contact
    if (dist < 1.4 && Math.abs(target.y - this.pos.y) < 2 && this.attackCD <= 0) {
      this.attacked = 4; this.attackCD = 1.0;
    }

    // knockback
    if (Math.abs(this.kbx) + Math.abs(this.kbz) > 0.05) {
      const nx = this.pos.x + this.kbx * dt, nz = this.pos.z + this.kbz * dt;
      if (!w.isSolid(Math.floor(nx), Math.floor(this.pos.y), Math.floor(nz))) { this.pos.x = nx; this.pos.z = nz; }
      const decay = Math.pow(0.0001, dt); this.kbx *= decay; this.kbz *= decay;
    }
    if (this.pos.y < -25) this.dead = true;

    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
    const swing = onGround ? Math.sin(this.anim) * 0.6 : 0;
    this.legs.forEach((l, i) => { l.rotation.x = swing * (i % 2 === 0 ? 1 : -1); });
    this.arms.forEach((a) => { a.rotation.x = -1.4; });   // arms outstretched
  }
  dispose(scene) { scene.remove(this.obj); }
}

// ---- hostile: Enderman (drops ender pearls) ----
function buildEnderman() {
  const g = new THREE.Group();
  const body = mat(0x0d0d12), eye = mat(0xcf6cff);
  g.add(box(0.4, 0.9, 0.32, body, 0, 1.65, 0));          // tall torso
  g.add(box(0.46, 0.42, 0.42, body, 0, 2.42, 0));        // head
  g.add(box(0.13, 0.08, 0.05, eye, -0.1, 2.48, -0.22));
  g.add(box(0.13, 0.08, 0.05, eye, 0.1, 2.48, -0.22));
  const arms = [];
  for (const x of [-0.3, 0.3]) { const a = box(0.12, 1.15, 0.12, body, x, 1.5, 0); g.add(a); arms.push(a); }
  const legs = [];
  for (const x of [-0.12, 0.12]) { const l = box(0.14, 1.1, 0.14, body, x, 0.55, 0); g.add(l); legs.push(l); }
  return { group: g, legs, arms };
}
class Enderman {
  constructor(world, scene) {
    this.world = world;
    const built = buildEnderman();
    this.obj = built.group; this.legs = built.legs; this.arms = built.arms;
    scene.add(this.obj);
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.vy = 0; this.anim = 0;
    this.hp = 40; this.dead = false; this.speed = 2.3; this.attackCD = 0;
    this.kbx = 0; this.kbz = 0; this.attacked = 0;
    this.drop = { id: ITEM.ENDER_PEARL, n: 1 };
  }
  place(x, y, z) { this.pos.set(x, y, z); }
  takeHit(dmg, kx, kz) { this.hp -= dmg; this.kbx = kx * 6; this.kbz = kz * 6; this.vy = Math.max(this.vy, 4); if (this.hp <= 0) this.dead = true; }
  update(dt, target) {
    const w = this.world; this.attacked = 0; this.attackCD -= dt;
    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const feetL = Math.floor(this.pos.y + 0.0001);
    let stand = -Infinity;
    for (let L = feetL; L >= feetL - 4; L--) if (w.isSolid(bx, L - 1, bz)) { stand = L; break; }
    this.vy -= 22 * dt; if (this.vy < -40) this.vy = -40;
    let ny = this.pos.y + this.vy * dt; let onGround = false;
    if (stand !== -Infinity && ny <= stand) { ny = stand; this.vy = 0; onGround = true; }
    this.pos.y = ny;
    let dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz); this.yaw = Math.atan2(-dx, -dz);
    if (onGround && dist > 1.1) {
      dx /= dist || 1; dz /= dist || 1;
      const nx = this.pos.x + dx * this.speed * dt, nz = this.pos.z + dz * this.speed * dt;
      const tbx = Math.floor(nx), tbz = Math.floor(nz);
      const stepUp = w.isSolid(tbx, feetL, tbz);
      const headBlocked = w.isSolid(tbx, feetL + (stepUp ? 2 : 1), tbz);
      if (!headBlocked) { this.pos.x = nx; this.pos.z = nz; if (stepUp && w.isSolid(tbx, feetL - 1, tbz)) this.pos.y = feetL + 1; this.anim += dt * 8; }
      else if (onGround) this.vy = 7;
    }
    if (dist < 1.5 && Math.abs(target.y - this.pos.y) < 2.4 && this.attackCD <= 0) { this.attacked = 7; this.attackCD = 1.0; }
    if (Math.abs(this.kbx) + Math.abs(this.kbz) > 0.05) {
      const nx = this.pos.x + this.kbx * dt, nz = this.pos.z + this.kbz * dt;
      if (!w.isSolid(Math.floor(nx), Math.floor(this.pos.y), Math.floor(nz))) { this.pos.x = nx; this.pos.z = nz; }
      const decay = Math.pow(0.0001, dt); this.kbx *= decay; this.kbz *= decay;
    }
    if (this.pos.y < -25) this.dead = true;
    this.obj.position.copy(this.pos); this.obj.rotation.y = this.yaw;
    const swing = onGround ? Math.sin(this.anim) * 0.5 : 0;
    this.legs.forEach((l, i) => { l.rotation.x = swing * (i % 2 === 0 ? 1 : -1); });
  }
  dispose(scene) { scene.remove(this.obj); }
}

// ---- hostile: Blaze (nether fortresses; drops blaze rods) ----
function buildBlaze() {
  const g = new THREE.Group();
  const core = mat(0xf2c200), rod = mat(0xe07a14);
  g.add(box(0.55, 0.55, 0.55, core, 0, 1.4, 0));
  const rods = [];
  for (const [ox, oz] of [[-0.3, 0], [0.3, 0], [0, -0.3], [0, 0.3]]) { const r = box(0.1, 0.75, 0.1, rod, ox, 1.4, oz); g.add(r); rods.push(r); }
  return { group: g, rods };
}
class Blaze {
  constructor(world, scene) {
    this.world = world;
    const built = buildBlaze(); this.obj = built.group; this.rods = built.rods;
    scene.add(this.obj);
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.t = Math.random() * 6.28;
    this.hp = 16; this.dead = false; this.speed = 2.2; this.attackCD = 0;
    this.kbx = 0; this.kbz = 0; this.attacked = 0;
    this.drop = { id: ITEM.BLAZE_ROD, n: 1 + (Math.random() * 2 | 0) };
  }
  place(x, y, z) { this.pos.set(x, y, z); }
  takeHit(dmg, kx, kz) { this.hp -= dmg; this.kbx = kx * 5; this.kbz = kz * 5; if (this.hp <= 0) this.dead = true; }
  update(dt, target) {
    const w = this.world; this.attacked = 0; this.attackCD -= dt; this.t += dt;
    let dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz); this.yaw = Math.atan2(-dx, -dz);
    if (dist > 2.4) {
      dx /= dist || 1; dz /= dist || 1;
      const nx = this.pos.x + dx * this.speed * dt, nz = this.pos.z + dz * this.speed * dt;
      if (!w.isSolid(Math.floor(nx), Math.floor(this.pos.y), Math.floor(nz))) { this.pos.x = nx; this.pos.z = nz; }
    }
    const desiredY = target.y + 1.1;
    this.pos.y += (desiredY - this.pos.y) * Math.min(1, dt * 1.8);
    const floor = w.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z));
    if (floor > 0 && this.pos.y < floor + 0.5) this.pos.y = floor + 0.5;
    const d3 = Math.hypot(target.x - this.pos.x, target.y - this.pos.y, target.z - this.pos.z);
    if (d3 < 6 && this.attackCD <= 0) { this.attacked = 3; this.attackCD = 1.4; }   // fireball / contact
    if (Math.abs(this.kbx) + Math.abs(this.kbz) > 0.05) {
      this.pos.x += this.kbx * dt; this.pos.z += this.kbz * dt;
      const decay = Math.pow(0.0001, dt); this.kbx *= decay; this.kbz *= decay;
    }
    if (this.pos.y < -25) this.dead = true;
    this.obj.position.copy(this.pos); this.obj.rotation.y = this.yaw;
    this.rods.forEach((r, i) => { r.position.y = 1.4 + Math.sin(this.t * 4 + i) * 0.12; });
  }
  dispose(scene) { scene.remove(this.obj); }
}

// ---- End boss: End Crystal (heals the dragon until destroyed) ----
function buildEndCrystal() {
  const g = new THREE.Group();
  const base = mat(0x241531), core = mat(0xc060ff);
  g.add(box(0.95, 0.28, 0.95, base, 0, 0.14, 0));
  const c = box(0.5, 0.5, 0.5, core, 0, 0.95, 0); g.add(c);
  return { group: g, core: c };
}
class EndCrystal {
  constructor(world, scene, x, y, z) {
    this.world = world; const b = buildEndCrystal(); this.obj = b.group; this.core = b.core; scene.add(this.obj);
    this.pos = new THREE.Vector3(x, y, z); this.obj.position.copy(this.pos);
    this.hp = 5; this.dead = false; this.t = Math.random() * 6.28;
    this.isCrystal = true; this.attacked = 0; this.drop = null; this.hitRadius = 1.0;
  }
  place() {}
  takeHit(dmg) { this.hp -= dmg; if (this.hp <= 0) this.dead = true; }
  update(dt) { this.attacked = 0; this.t += dt; this.core.rotation.y = this.t * 1.5; this.core.position.y = 0.95 + Math.sin(this.t * 2) * 0.12; }
  dispose(scene) { scene.remove(this.obj); }
}

// ---- End boss: the Ender Dragon ----
function buildDragon() {
  const g = new THREE.Group();
  const body = mat(0x130f1a), wingm = mat(0x251b34), eye = mat(0xcf3bff);
  g.add(box(1.6, 1.2, 3.2, body, 0, 0, 0));              // body
  g.add(box(0.7, 0.7, 2.0, body, 0, 0.3, -2.2));         // neck
  g.add(box(1.0, 0.9, 1.2, body, 0, 0.45, -3.6));        // head
  g.add(box(0.2, 0.13, 0.1, eye, -0.3, 0.65, -4.05));
  g.add(box(0.2, 0.13, 0.1, eye, 0.3, 0.65, -4.05));
  g.add(box(0.6, 0.6, 2.8, body, 0, 0, 2.8));            // tail
  const wings = [];
  const lw = box(3.6, 0.16, 1.7, wingm, -2.6, 0.4, 0.2); g.add(lw); wings.push(lw);
  const rw = box(3.6, 0.16, 1.7, wingm, 2.6, 0.4, 0.2); g.add(rw); wings.push(rw);
  return { group: g, wings };
}
class EnderDragon {
  constructor(world, scene, manager) {
    this.world = world; this.manager = manager;
    const b = buildDragon(); this.obj = b.group; this.wings = b.wings; scene.add(this.obj);
    this.pos = new THREE.Vector3(0, END_BASE + 18, 0);
    this.maxhp = 200; this.hp = 200; this.dead = false; this.attacked = 0; this.attackCD = 0;
    this.t = Math.random() * 6.28; this.phase = 'circle'; this.phaseT = 4; this.yaw = 0;
    this.isDragon = true; this.drop = null; this.hitRadius = 2.6;
  }
  place() {}
  takeHit(dmg) {
    // crystals out-heal melee — you must destroy them first (just like Minecraft)
    if (this.manager.crystalsAlive() > 0) { this.hp = Math.min(this.maxhp, this.hp + dmg * 0.5); return; }
    this.hp -= dmg; if (this.hp <= 0) this.dead = true;
  }
  update(dt, target) {
    this.attacked = 0; this.attackCD -= dt; this.t += dt; this.phaseT -= dt;
    const crystals = this.manager.crystalsAlive();
    if (crystals > 0) this.hp = Math.min(this.maxhp, this.hp + 2 * dt);     // healed by crystals
    if (this.phaseT <= 0) {
      const roll = Math.random();
      if (crystals === 0 && roll < 0.5) { this.phase = 'perch'; this.phaseT = 4; }
      else if (roll < 0.5) { this.phase = 'dive'; this.phaseT = 3; }
      else { this.phase = 'circle'; this.phaseT = 4 + Math.random() * 3; }
    }
    let tx, ty, tz;
    if (this.phase === 'circle') { const r = 30; tx = Math.cos(this.t * 0.5) * r; tz = Math.sin(this.t * 0.5) * r; ty = END_BASE + 18 + Math.sin(this.t) * 2; }
    else if (this.phase === 'dive') { tx = target.x; tz = target.z; ty = target.y + 3; }
    else { tx = 0; tz = 0; ty = END_BASE + 9; }            // perch low at centre, vulnerable
    const dx = tx - this.pos.x, dy = ty - this.pos.y, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const move = (this.phase === 'dive' ? 11 : this.phase === 'perch' ? 6 : 7) * dt;
    const step = Math.min(1, move / d);
    this.pos.x += dx * step; this.pos.y += dy * step; this.pos.z += dz * step;
    this.yaw = Math.atan2(-dx, -dz);
    const pd = Math.hypot(target.x - this.pos.x, target.y - this.pos.y, target.z - this.pos.z);
    if (pd < 3.8 && this.attackCD <= 0) { this.attacked = 6; this.attackCD = 1.0; }
    const flap = Math.sin(this.t * 4) * 0.5;
    this.wings[0].rotation.z = flap; this.wings[1].rotation.z = -flap;
    this.obj.position.copy(this.pos); this.obj.rotation.y = this.yaw;
  }
  dispose(scene) { scene.remove(this.obj); }
}

class MobManager {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.mobs = [];
    this.hostiles = [];
    this.bosses = [];          // end crystals + the ender dragon
    this.dragon = null;
  }

  spawnInitial(centerX, centerZ, count = 6, maxDist = 14, forceType = null) {
    let spawned = 0, attempts = 0;
    while (spawned < count && attempts < count * 12) {
      attempts++;
      const type = forceType || NAMES[spawned % NAMES.length];
      const ang = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * (maxDist - 2);
      const bx = Math.floor(centerX + Math.cos(ang) * dist);
      const bz = Math.floor(centerZ + Math.sin(ang) * dist);
      const y = this.world.surfaceY(bx, bz);
      // require an actual solid block directly beneath the spawn point
      if (y <= 0 || !this.world.isSolid(bx, y - 1, bz)) continue;
      const mob = new Mob(type, this.world, this.scene);
      mob.place(bx + 0.5, y, bz + 0.5);
      this.mobs.push(mob);
      spawned++;
    }
  }

  // returns total contact damage the hostiles dealt to the player this frame
  update(dt, target) {
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      m.update(dt);
      if (m.dead) { m.dispose(this.scene); this.mobs.splice(i, 1); }
    }
    let dmg = 0;
    if (target) {
      for (let i = this.hostiles.length - 1; i >= 0; i--) {
        const z = this.hostiles[i];
        z.update(dt, target);
        dmg += z.attacked;
        const far = Math.hypot(z.pos.x - target.x, z.pos.z - target.z) > 64;
        if (z.dead || far) { z.dispose(this.scene); this.hostiles.splice(i, 1); }
      }
      // bosses (end crystals + dragon) never despawn from distance
      for (let i = this.bosses.length - 1; i >= 0; i--) {
        const b = this.bosses[i];
        b.update(dt, target);
        dmg += b.attacked || 0;
        if (b.dead) { if (b === this.dragon) this.dragon = null; b.dispose(this.scene); this.bosses.splice(i, 1); }
      }
    }
    return dmg;
  }

  crystalsAlive() { let n = 0; for (const b of this.bosses) if (b.isCrystal && !b.dead) n++; return n; }

  // set up the boss arena: an end crystal atop each pillar + the dragon
  startEndFight() {
    this.clearBosses();
    for (const p of END_PILLARS) this.bosses.push(new EndCrystal(this.world, this.scene, p.x + 0.5, END_BASE + p.h + 1, p.z + 0.5));
    this.dragon = new EnderDragon(this.world, this.scene, this);
    this.bosses.push(this.dragon);
  }
  clearBosses() { for (const b of this.bosses) b.dispose(this.scene); this.bosses = []; this.dragon = null; }

  spawnEnderman(centerX, centerZ, count) {
    let spawned = 0, attempts = 0;
    while (spawned < count && attempts < count * 14) {
      attempts++;
      const ang = Math.random() * Math.PI * 2, dist = 10 + Math.random() * 16;
      const bx = Math.floor(centerX + Math.cos(ang) * dist), bz = Math.floor(centerZ + Math.sin(ang) * dist);
      const y = this.world.surfaceY(bx, bz);
      if (y <= 0 || !this.world.isSolid(bx, y - 1, bz)) continue;
      const e = new Enderman(this.world, this.scene); e.place(bx + 0.5, y, bz + 0.5);
      this.hostiles.push(e); spawned++;
    }
  }

  spawnBlazes(centerX, centerZ, count) {
    let spawned = 0, attempts = 0;
    while (spawned < count && attempts < count * 14) {
      attempts++;
      const ang = Math.random() * Math.PI * 2, dist = 8 + Math.random() * 14;
      const bx = Math.floor(centerX + Math.cos(ang) * dist), bz = Math.floor(centerZ + Math.sin(ang) * dist);
      const y = this.world.surfaceY(bx, bz);
      if (y <= 0) continue;
      const b = new Blaze(this.world, this.scene); b.place(bx + 0.5, y + 2, bz + 0.5);
      this.hostiles.push(b); spawned++;
    }
  }

  spawnHostiles(centerX, centerZ, count) {
    let spawned = 0, attempts = 0;
    while (spawned < count && attempts < count * 14) {
      attempts++;
      const ang = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 18;          // spawn in a ring around the player
      const bx = Math.floor(centerX + Math.cos(ang) * dist);
      const bz = Math.floor(centerZ + Math.sin(ang) * dist);
      const y = this.world.surfaceY(bx, bz);
      if (y <= 0 || !this.world.isSolid(bx, y - 1, bz)) continue;
      const z = new Zombie(this.world, this.scene);
      z.place(bx + 0.5, y, bz + 0.5);
      this.hostiles.push(z);
      spawned++;
    }
  }

  // player melee: damage the nearest mob in front within reach.
  // Returns null if nothing was hit, else an array of {id,n} drops from kills.
  attack(eye, dir, reach, dmg) {
    let best = null, bestT = reach;
    const consider = (m) => {
      const cx = m.pos.x - eye.x, cy = (m.pos.y + 0.9) - eye.y, cz = m.pos.z - eye.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;       // distance along the look ray
      if (t < 0 || t > reach) return;
      const px = cx - dir.x * t, py = cy - dir.y * t, pz = cz - dir.z * t;
      if (Math.hypot(px, py, pz) > (m.hitRadius || 0.9)) return;   // too far off the ray
      if (t < bestT) { bestT = t; best = m; }
    };
    for (const m of this.hostiles) consider(m);
    for (const m of this.bosses) consider(m);
    for (const m of this.mobs) consider(m);
    if (!best) return null;
    const kx = best.pos.x - eye.x, kz = best.pos.z - eye.z;
    const kl = Math.hypot(kx, kz) || 1;
    best.takeHit(dmg, kx / kl, kz / kl);
    const drops = [];
    if (best.dead) {
      if (best.drop) drops.push(best.drop);
      if (best === this.dragon) this.dragon = null;
      for (const arr of [this.hostiles, this.mobs, this.bosses]) {
        const ix = arr.indexOf(best);
        if (ix >= 0) { arr.splice(ix, 1); break; }
      }
      best.dispose(this.scene);
    }
    return drops;
  }

  clearHostiles() {
    for (const z of this.hostiles) z.dispose(this.scene);
    this.hostiles = [];
  }

  clear() {
    for (const m of this.mobs) m.dispose(this.scene);
    for (const z of this.hostiles) z.dispose(this.scene);
    for (const b of this.bosses) b.dispose(this.scene);
    this.mobs = []; this.hostiles = []; this.bosses = []; this.dragon = null;
  }

  hide() {
    for (const m of this.mobs) this.scene.remove(m.obj);
    for (const z of this.hostiles) this.scene.remove(z.obj);
    for (const b of this.bosses) this.scene.remove(b.obj);
  }
  show() {
    for (const m of this.mobs) this.scene.add(m.obj);
    for (const z of this.hostiles) this.scene.add(z.obj);
    for (const b of this.bosses) this.scene.add(b.obj);
  }
}
