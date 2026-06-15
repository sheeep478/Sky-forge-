// First-person player: movement, AABB voxel collision, gravity, jump, fly.


// HEIGHT is a global from world.js

const WIDTH = 0.6;        // player box width/depth
const TALL = 1.8;         // player height
const EYE = 1.62;         // eye height from feet
const HALF = WIDTH / 2;

class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3(0, 40, 0);   // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.creative = false;
    this.speed = 4.6;
    this.sprintMul = 1.6;
  }

  setMode(creative) {
    this.creative = creative;
    this.flying = false;
  }

  toggleFly() {
    if (this.creative) this.flying = !this.flying;
  }

  look(dx, dy) {
    const s = 0.0024;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  // input: { mx, mz (analog -1..1), jump, sprint, up, down }
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    const w = this.world;

    // desired horizontal movement relative to yaw.
    // forward dir = (-sin, -cos), right dir = (cos, -sin); mz<0 means forward.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let fx = 0, fz = 0;
    const mz = input.mz, mx = input.mx;
    fx += mx * cos + mz * sin;
    fz += mz * cos - mx * sin;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }

    let sp = this.speed * (input.sprint ? this.sprintMul : 1);

    if (this.flying) {
      sp *= 1.8;
      this.vel.x = fx * sp;
      this.vel.z = fz * sp;
      this.vel.y = 0;
      if (input.jump || input.up) this.vel.y = sp;
      if (input.down) this.vel.y = -sp;
    } else {
      this.vel.x = fx * sp;
      this.vel.z = fz * sp;
      this.vel.y -= 24 * dt;            // gravity
      if (this.vel.y < -55) this.vel.y = -55;
      if ((input.jump || input.up) && this.onGround) {
        this.vel.y = 8.4;
        this.onGround = false;
      }
    }

    // integrate with per-axis collision
    this._moveAxis('x', this.vel.x * dt);
    this._moveAxis('z', this.vel.z * dt);
    this.onGround = false;
    this._moveAxis('y', this.vel.y * dt);

    // safety: never fall out of world
    if (this.pos.y < -20) { this.pos.set(this.pos.x, HEIGHT + 2, this.pos.z); this.vel.set(0,0,0); }

    // update camera
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  _collides(px, py, pz) {
    const w = this.world;
    const minX = Math.floor(px - HALF), maxX = Math.floor(px + HALF);
    const minY = Math.floor(py), maxY = Math.floor(py + TALL - 0.01);
    const minZ = Math.floor(pz - HALF), maxZ = Math.floor(pz + HALF);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (w.isSolid(x, y, z)) return true;
    return false;
  }

  _moveAxis(axis, amount) {
    if (amount === 0) return;
    const p = this.pos.clone();
    p[axis] += amount;
    if (!this._collides(p.x, p.y, p.z)) {
      this.pos[axis] = p[axis];
      return;
    }
    // collision on this axis: stop velocity, record ground
    if (axis === 'y') {
      if (amount < 0) this.onGround = true;
      this.vel.y = 0;
    } else {
      this.vel[axis] = 0;
    }
    // step nudge: try to climb a 1-block step when moving horizontally on ground
    if ((axis === 'x' || axis === 'z') && this.onGround) {
      const up = this.pos.clone();
      up.y += 1.05;
      up[axis] += amount;
      if (!this._collides(up.x, up.y, up.z)) {
        this.pos.y += 1.05;
        this.pos[axis] += amount;
      }
    }
  }

  // Return camera direction for raycasting.
  getDirection() {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return dir;
  }

  getEyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }
}
