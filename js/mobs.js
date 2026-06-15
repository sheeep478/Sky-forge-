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

const BUILDERS = { pig: buildPig, cow: buildCow, chicken: buildChicken };
const NAMES = ['pig', 'cow', 'chicken'];

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
  }

  place(x, y, z) { this.pos.set(x, y, z); }

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

class MobManager {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.mobs = [];
  }

  spawnInitial(centerX, centerZ, count = 6, maxDist = 14) {
    let spawned = 0, attempts = 0;
    while (spawned < count && attempts < count * 12) {
      attempts++;
      const type = NAMES[spawned % NAMES.length];
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

  update(dt) {
    for (const m of this.mobs) m.update(dt);
  }

  clear() {
    for (const m of this.mobs) m.dispose(this.scene);
    this.mobs = [];
  }

  hide() { for (const m of this.mobs) this.scene.remove(m.obj); }
  show() { for (const m of this.mobs) this.scene.add(m.obj); }
}
