// Voxel world: chunk storage, terrain generation (regular / flat / skyblock),
// and face-culled mesh building with baked directional shading.

// Globals provided by earlier scripts: THREE, Noise, mulberry32,
// BLOCK, BLOCK_INFO, buildAtlas, faceUV.

const CHUNK = 16;          // chunk width/depth in blocks
const HEIGHT = 64;         // world height in blocks
const SEA_LEVEL = 24;

// Six face directions: [normal, brightness]
const DIRS = [
  { n: [0, 1, 0], name: 'top', bright: 1.0,
    corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { n: [0, -1, 0], name: 'bottom', bright: 0.5,
    corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { n: [0, 0, 1], name: 'side', bright: 0.8,
    corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { n: [0, 0, -1], name: 'side', bright: 0.8,
    corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
  { n: [1, 0, 0], name: 'side', bright: 0.65,
    corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
  { n: [-1, 0, 0], name: 'side', bright: 0.65,
    corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
];

class World {
  constructor(scene, seed, type) {
    this.scene = scene;
    this.seed = seed;
    this.type = type;
    this.noise = new Noise(seed);
    this.chunks = new Map();        // "cx,cz" -> { blocks: Uint8Array, mesh, tmesh, maxY }
    this.renderDistance = 4;

    const atlas = buildAtlas();
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture, vertexColors: true,
    });
    this.tMaterial = new THREE.MeshBasicMaterial({
      map: atlas.texture, vertexColors: true,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  key(cx, cz) { return cx + ',' + cz; }
  _idx(x, y, z) { return (y * CHUNK + z) * CHUNK + x; }

  // ---- block access in world coordinates ----
  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const ch = this.chunks.get(this.key(cx, cz));
    if (!ch) return BLOCK.AIR;
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    return ch.blocks[this._idx(lx, wy, lz)];
  }

  setBlock(wx, wy, wz, id, rebuild = true) {
    if (wy < 0 || wy >= HEIGHT) return;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const ch = this.chunks.get(this.key(cx, cz));
    if (!ch) return;
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    ch.blocks[this._idx(lx, wy, lz)] = id;
    if (id !== BLOCK.AIR && wy > ch.maxY) ch.maxY = wy;
    if (rebuild) {
      this.buildMesh(cx, cz);
      // rebuild neighbors if on edge
      if (lx === 0) this.buildMesh(cx - 1, cz);
      if (lx === CHUNK - 1) this.buildMesh(cx + 1, cz);
      if (lz === 0) this.buildMesh(cx, cz - 1);
      if (lz === CHUNK - 1) this.buildMesh(cx, cz + 1);
    }
  }

  isSolid(wx, wy, wz) {
    const b = this.getBlock(Math.floor(wx), Math.floor(wy), Math.floor(wz));
    return b !== BLOCK.AIR && BLOCK_INFO[b] && BLOCK_INFO[b].solid;
  }

  // ---- generation ----
  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    if (this.chunks.has(k)) return this.chunks.get(k);
    const ch = { blocks: new Uint8Array(CHUNK * HEIGHT * CHUNK), mesh: null, tmesh: null, maxY: 0 };
    this.chunks.set(k, ch);
    this.generate(cx, cz, ch);
    return ch;
  }

  generate(cx, cz, ch) {
    if (this.type === 'flat') return this._genFlat(ch);
    if (this.type === 'skyblock') return this._genSkyblock(cx, cz, ch);
    return this._genRegular(cx, cz, ch);
  }

  _set(ch, lx, y, lz, id) {
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
    ch.blocks[this._idx(lx, y, lz)] = id;
    if (id !== BLOCK.AIR && y > ch.maxY) ch.maxY = y;
  }

  _genFlat(ch) {
    for (let x = 0; x < CHUNK; x++)
      for (let z = 0; z < CHUNK; z++) {
        this._set(ch, x, 0, z, BLOCK.BEDROCK);
        this._set(ch, x, 1, z, BLOCK.DIRT);
        this._set(ch, x, 2, z, BLOCK.DIRT);
        this._set(ch, x, 3, z, BLOCK.GRASS);
      }
  }

  _genSkyblock(cx, cz, ch) {
    // A single floating island near origin chunk only.
    if (cx !== 0 || cz !== 0) return;
    const base = 28;
    for (let x = 4; x <= 11; x++)
      for (let z = 4; z <= 11; z++) {
        this._set(ch, x, base, z, BLOCK.DIRT);
        this._set(ch, x, base + 1, z, BLOCK.DIRT);
        this._set(ch, x, base + 2, z, BLOCK.GRASS);
      }
    // a tree
    this._tree(ch, 6, base + 3, 6);
    // small extra floating block of sand (challenge resource)
    this._set(ch, 13, base + 2, 13, BLOCK.SAND);
    this._set(ch, 13, base + 1, 13, BLOCK.SAND);
  }

  _genRegular(cx, cz, ch) {
    const rnd = mulberry32((this.seed ^ (cx * 73856093) ^ (cz * 19349663)) >>> 0);
    for (let x = 0; x < CHUNK; x++) {
      for (let z = 0; z < CHUNK; z++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        const e = this.noise.fbm(wx, wz, 4, 0.5, 0.012);     // 0..1
        const hilliness = this.noise.fbm(wx + 1000, wz - 1000, 2, 0.5, 0.005);
        const height = Math.floor(SEA_LEVEL - 6 + e * 26 + hilliness * 8);

        for (let y = 0; y <= height; y++) {
          let block = BLOCK.STONE;
          if (y === 0) block = BLOCK.BEDROCK;
          else if (y === height) {
            if (height < SEA_LEVEL + 1) block = BLOCK.SAND;
            else if (height > SEA_LEVEL + 18) block = BLOCK.SNOW;
            else block = BLOCK.GRASS;
          } else if (y > height - 4) {
            block = (height < SEA_LEVEL + 1) ? BLOCK.SAND : BLOCK.DIRT;
          }
          this._set(ch, x, y, z, block);
        }
        // water fill
        for (let y = height + 1; y <= SEA_LEVEL; y++) this._set(ch, x, y, z, BLOCK.WATER);

        // trees on grass, kept away from edges so canopy stays in-chunk
        if (height >= SEA_LEVEL + 1 && height <= SEA_LEVEL + 17 &&
            x >= 2 && x <= 13 && z >= 2 && z <= 13 && rnd() < 0.02) {
          this._tree(ch, x, height + 1, z, rnd);
        }
      }
    }
  }

  _tree(ch, x, y, z, rnd = Math.random) {
    const h = 4 + (rnd() * 2 | 0);
    for (let i = 0; i < h; i++) this._set(ch, x, y + i, z, BLOCK.WOOD);
    const top = y + h;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -2; dy <= 0; dy++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (dy === 0 && dx === 0 && dz === 0) continue;
          this._set(ch, x + dx, top + dy, z + dz, BLOCK.LEAVES);
        }
    this._set(ch, x, top, z, BLOCK.LEAVES);
    this._set(ch, x, top + 1, z, BLOCK.LEAVES);
  }

  // ---- meshing ----
  buildMesh(cx, cz) {
    const ch = this.chunks.get(this.key(cx, cz));
    if (!ch) return;

    const pos = [], col = [], uv = [], idx = [];
    const tpos = [], tcol = [], tuv = [], tidx = [];
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const maxY = Math.min(ch.maxY + 1, HEIGHT - 1);

    for (let y = 0; y <= maxY; y++) {
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const b = ch.blocks[this._idx(x, y, z)];
          if (b === BLOCK.AIR) continue;
          const info = BLOCK_INFO[b];
          // Only water & glass use the alpha-blended pass; leaves stay opaque
          // (but still cull their shared interior faces via the transparent flag).
          const isT = (b === BLOCK.WATER || b === BLOCK.GLASS);
          const wx = ox + x, wz = oz + z;

          for (const d of DIRS) {
            const nb = this.getBlock(wx + d.n[0], y + d.n[1], wz + d.n[2]);
            const nInfo = BLOCK_INFO[nb];
            // draw face if neighbor is air, OR neighbor transparent & different block
            if (nb !== BLOCK.AIR && nInfo && !nInfo.transparent) continue;
            if (nb !== BLOCK.AIR && nInfo && nInfo.transparent && nb === b) continue;

            const P = isT ? tpos : pos, C = isT ? tcol : col,
                  U = isT ? tuv : uv, I = isT ? tidx : idx;
            const start = P.length / 3;
            const uvr = faceUV(b, d.name === 'top' || d.name === 'bottom' ? d.name : 'side');
            const br = d.bright;
            for (let c = 0; c < 4; c++) {
              const cc = d.corners[c];
              P.push(x + cc[0], y + cc[1], z + cc[2]);
              C.push(br, br, br);
            }
            // uv per corner: order matches corners winding
            U.push(uvr[0], uvr[1], uvr[2], uvr[1], uvr[2], uvr[3], uvr[0], uvr[3]);
            I.push(start, start + 1, start + 2, start, start + 2, start + 3);
          }
        }
      }
    }

    // dispose old
    if (ch.mesh) { ch.mesh.geometry.dispose(); this.scene.remove(ch.mesh); ch.mesh = null; }
    if (ch.tmesh) { ch.tmesh.geometry.dispose(); this.scene.remove(ch.tmesh); ch.tmesh = null; }

    if (pos.length) {
      ch.mesh = this._makeMesh(pos, col, uv, idx, this.material);
      ch.mesh.position.set(ox, 0, oz);
      this.scene.add(ch.mesh);
    }
    if (tpos.length) {
      ch.tmesh = this._makeMesh(tpos, tcol, tuv, tidx, this.tMaterial);
      ch.tmesh.position.set(ox, 0, oz);
      this.scene.add(ch.tmesh);
    }
  }

  _makeMesh(pos, col, uv, idx, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return new THREE.Mesh(g, mat);
  }

  // ---- streaming around the player ----
  update(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK), pcz = Math.floor(playerZ / CHUNK);
    const r = this.renderDistance;
    const needed = new Set();

    // generate + mesh missing chunks (a few per frame to avoid hitches)
    let budget = 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        needed.add(this.key(cx, cz));
        const ch = this.chunks.get(this.key(cx, cz));
        if (!ch) { this.ensureChunk(cx, cz); }
        const c2 = this.chunks.get(this.key(cx, cz));
        if (c2 && !c2.mesh && !c2.tmesh && !c2._meshed && budget > 0) {
          this.buildMesh(cx, cz);
          c2._meshed = true;
          budget--;
        }
      }
    }

    // unload distant chunk meshes (keep data) to save memory
    for (const [k, ch] of this.chunks) {
      if (!needed.has(k) && (ch.mesh || ch.tmesh)) {
        const [kx, kz] = k.split(',').map(Number);
        if (Math.abs(kx - pcx) > r + 1 || Math.abs(kz - pcz) > r + 1) {
          if (ch.mesh) { ch.mesh.geometry.dispose(); this.scene.remove(ch.mesh); ch.mesh = null; }
          if (ch.tmesh) { ch.tmesh.geometry.dispose(); this.scene.remove(ch.tmesh); ch.tmesh = null; }
          ch._meshed = false;
        }
      }
    }
  }

  // initial load: synchronously build the immediate area for a clean spawn
  preload(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK), pcz = Math.floor(playerZ / CHUNK);
    const r = this.renderDistance;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) this.ensureChunk(pcx + dx, pcz + dz);
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        this.buildMesh(pcx + dx, pcz + dz);
        const c = this.chunks.get(this.key(pcx + dx, pcz + dz));
        if (c) c._meshed = true;
      }
  }

  // find a safe spawn Y at given x,z (top solid + 1)
  surfaceY(wx, wz) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const b = this.getBlock(wx, y, wz);
      if (b !== BLOCK.AIR && BLOCK_INFO[b] && BLOCK_INFO[b].solid) return y + 1;
    }
    return SEA_LEVEL + 2;
  }
}
