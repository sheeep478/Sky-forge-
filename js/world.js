// Voxel world: chunk storage, terrain generation (regular / flat / skyblock),
// and face-culled mesh building with baked directional shading.

// Globals provided by earlier scripts: THREE, Noise, mulberry32,
// BLOCK, BLOCK_INFO, buildAtlas, faceUV.

const CHUNK = 16;          // chunk width/depth in blocks
const HEIGHT = 64;         // world height in blocks
const SEA_LEVEL = 24;

// Terrain generation version. Saved worlds remember the version they were
// created with and always regenerate using it, so changing generation never
// shifts the terrain under existing builds. BUMP this when generation changes,
// and branch on `this.genVersion` instead of editing an existing version path.
// v2 adds nether fortresses, strongholds (with the End portal room), and the End.
const GEN_VERSION = 2;

// The End's obsidian pillars (fixed, deterministic) so terrain generation and
// the boss-fight code agree on where the end crystals sit.
const END_BASE = 40;             // island surface level
const END_PILLARS = (() => {
  const list = [];
  const N = 8, ring = 33;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    list.push({
      x: Math.round(Math.cos(a) * ring),
      z: Math.round(Math.sin(a) * ring),
      h: 4 + (i % 4) * 2,                  // pillar height above the island (reachable by pillaring up)
      r: 2 + (i % 3 === 0 ? 1 : 0),        // pillar radius
    });
  }
  return list;
})();

// Six face directions, each tagged with a face code (py/ny/px/nx/pz/nz).
const DIRS = [
  { n: [0, 1, 0], face: 'py', bright: 1.0,
    corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { n: [0, -1, 0], face: 'ny', bright: 0.5,
    corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { n: [0, 0, 1], face: 'pz', bright: 0.8,
    corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { n: [0, 0, -1], face: 'nz', bright: 0.8,
    corners: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
  { n: [1, 0, 0], face: 'px', bright: 0.65,
    corners: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]] },
  { n: [-1, 0, 0], face: 'nx', bright: 0.65,
    corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]] },
];

class World {
  constructor(scene, seed, type, genVersion) {
    this.scene = scene;
    this.seed = seed;
    this.type = type;
    this.genVersion = genVersion || GEN_VERSION;
    this.noise = new Noise(seed);
    this.chunks = new Map();        // "cx,cz" -> { blocks: Uint8Array, mesh, tmesh, maxY }
    this.edits = new Map();         // "x,y,z" -> id, for blocks changed after generation
    this.lootChests = [];           // structure chests awaiting loot registration
    this.renderDistance = 4;

    const atlas = buildAtlas();
    this.material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true });
    this.tMaterial = new THREE.MeshBasicMaterial({
      map: atlas.texture, vertexColors: true,
      transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    });

    // Shared day-brightness uniform. Final light = max(blockLight, skyLight*uDay),
    // with a darkness floor so unlit areas stay atmospheric but navigable.
    this.dayUniform = { value: 1.0 };
    const FLOOR = 0.1;
    const patch = (mat) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uDay = this.dayUniform;
        shader.vertexShader = 'attribute vec2 light;\nvarying vec2 vLight;\n' +
          shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n  vLight = light;');
        shader.fragmentShader = 'uniform float uDay;\nvarying vec2 vLight;\n' +
          shader.fragmentShader.replace('#include <dithering_fragment>',
            'float _L = max(vLight.y, vLight.x * uDay);\n' +
            '  _L = mix(' + FLOOR.toFixed(2) + ', 1.0, clamp(_L, 0.0, 1.0));\n' +
            '  gl_FragColor.rgb *= _L;\n  #include <dithering_fragment>');
      };
    };
    patch(this.material); patch(this.tMaterial);
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
    this.edits.set(wx + ',' + wy + ',' + wz, id);   // remember post-gen changes
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
    if (this.type === 'nether') return this._genNether(cx, cz, ch);
    if (this.type === 'aether') return this._genAether(cx, cz, ch);
    if (this.type === 'woolworld') return this._genWool(cx, cz, ch);
    if (this.type === 'sandbox') return this._genSandbox(ch);
    if (this.type === 'end') return this._genEnd(cx, cz, ch);
    return this._genRegular(cx, cz, ch);   // 'regular' and 'simple'
  }

  // The End: a central end-stone island floating in the void, ringed by tall
  // obsidian pillars (each topped with an end crystal placed by the boss code).
  _genEnd(cx, cz, ch) {
    const BASE = END_BASE;
    for (let x = 0; x < CHUNK; x++)
      for (let z = 0; z < CHUNK; z++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        const d = Math.hypot(wx, wz);
        // main island: a low dome ~84 blocks across
        if (d < 42) {
          const top = BASE + Math.floor(Math.max(0, 7 - d * 0.18));
          const depth = 5 + Math.floor(Math.max(0, 9 - d * 0.2));
          for (let y = top - depth; y <= top; y++) if (y >= 0 && y < HEIGHT) this._set(ch, x, y, z, BLOCK.END_STONE);
        }
        // obsidian pillars topped with bedrock (crystal base)
        for (const p of END_PILLARS) {
          if (Math.abs(wx - p.x) > p.r || Math.abs(wz - p.z) > p.r) continue;
          if (Math.hypot(wx - p.x, wz - p.z) > p.r + 0.4) continue;
          const ptop = BASE + p.h;
          for (let y = BASE - 2; y <= ptop; y++) if (y >= 0 && y < HEIGHT) this._set(ch, x, y, z, BLOCK.OBSIDIAN);
          if (wx === p.x && wz === p.z) this._set(ch, x, ptop, z, BLOCK.BEDROCK);   // crystal stands here
        }
      }
  }

  // 333: a flat sandstone testing world (no mobs)
  _genSandbox(ch) {
    for (let x = 0; x < CHUNK; x++)
      for (let z = 0; z < CHUNK; z++) {
        this._set(ch, x, 0, z, BLOCK.BEDROCK);
        for (let y = 1; y <= 3; y++) this._set(ch, x, y, z, BLOCK.SANDSTONE);
      }
  }

  // 478: a flat world of randomly-coloured wool
  _genWool(cx, cz, ch) {
    const cols = [BLOCK.WOOL, BLOCK.WOOL_RED, BLOCK.WOOL_ORANGE, BLOCK.WOOL_YELLOW, BLOCK.WOOL_LIME,
      BLOCK.WOOL_GREEN, BLOCK.WOOL_CYAN, BLOCK.WOOL_BLUE, BLOCK.WOOL_PURPLE, BLOCK.WOOL_PINK, BLOCK.WOOL_BLACK];
    for (let x = 0; x < CHUNK; x++)
      for (let z = 0; z < CHUNK; z++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        this._set(ch, x, 0, z, BLOCK.BEDROCK);
        for (let y = 1; y <= 3; y++) {
          const pick = cols[(this.noise._hash3(wx, y * 31, wz) * cols.length) | 0];
          this._set(ch, x, y, z, pick);
        }
      }
  }

  // the Aether (cheats only): floating grass islands in a bright sky
  _genAether(cx, cz, ch) {
    const BASE = 40;
    for (let x = 0; x < CHUNK; x++)
      for (let z = 0; z < CHUNK; z++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        const n = this.noise.fbm(wx, wz, 3, 0.5, 0.045);     // island mask
        if (n < 0.42) continue;                              // open sky
        const top = BASE + Math.floor((n - 0.42) * 26);
        const thick = 2 + Math.floor((n - 0.42) * 22);
        for (let y = top - thick; y <= top; y++) {
          if (y < 0 || y >= HEIGHT) continue;
          this._set(ch, x, y, z, y === top ? BLOCK.AETHER_GRASS : BLOCK.DIRT);
        }
        // occasional glowstone underside + trees on top
        const r = mulberry32((this.seed ^ (wx * 91) ^ (wz * 13)) >>> 0);
        if (r() < 0.02 && x >= 2 && x <= 13 && z >= 2 && z <= 13) this._tree(ch, x, top + 1, z, r);
        else if (r() < 0.04) this._set(ch, x, top - thick - 1, z, BLOCK.GLOWSTONE);
      }
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
        this._set(ch, x, 1, z, BLOCK.STONE);
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
    // a small sand resource sitting ON the island (not floating)
    this._set(ch, 10, base + 3, 10, BLOCK.SAND);
    this._set(ch, 10, base + 4, 10, BLOCK.SAND);
  }

  _genRegular(cx, cz, ch) {
    const rnd = mulberry32((this.seed ^ (cx * 73856093) ^ (cz * 19349663)) >>> 0);
    for (let x = 0; x < CHUNK; x++) {
      for (let z = 0; z < CHUNK; z++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        let height;
        if (this.type === 'simple') {
          // 123: simple, smooth rolling terrain (still has everything else)
          const s = this.noise.fbm(wx, wz, 2, 0.5, 0.012);
          height = Math.floor(SEA_LEVEL + (s - 0.4) * 34);
        } else {
          // Cross sea level near the noise's mean (~0.357) so lakes & oceans are
          // common everywhere; a low-frequency hill term adds mountains.
          const raw = this.noise.fbm(wx, wz, 4, 0.5, 0.03);
          const hill = this.noise.fbm(wx + 1000, wz - 1000, 2, 0.5, 0.013);
          height = Math.floor(SEA_LEVEL + (raw - 0.38) * 66 + (hill - 0.35) * 12);
          // lowland ponds/lakes (high-frequency noise self-averages, so these
          // appear reliably on every seed; mountains are left untouched).
          const pond = this.noise.fbm(wx + 7000, wz + 7000, 3, 0.5, 0.075);
          if (pond > 0.66 && height >= SEA_LEVEL - 2 && height <= SEA_LEVEL + 8) {
            height = SEA_LEVEL - 1 - Math.min(3, Math.floor((pond - 0.66) * 22));
          }
        }
        if (height < 1) height = 1;

        for (let y = 0; y <= height; y++) {
          let block = BLOCK.STONE;
          if (y === 0) block = BLOCK.BEDROCK;
          else if (y === height) {
            if (height < SEA_LEVEL + 1) block = BLOCK.SAND;
            else if (height > SEA_LEVEL + 18) block = BLOCK.SNOW;
            else block = BLOCK.GRASS;
          } else if (y > height - 4) {
            block = (height < SEA_LEVEL + 1) ? BLOCK.SAND : BLOCK.DIRT;
          } else {
            // ores embedded in stone, rarer/deeper for valuable ones
            const r = rnd();
            if (y < 13 && r < 0.0016) block = BLOCK.DIAMOND_ORE;
            else if (y < 20 && r < 0.004) block = BLOCK.GOLD_ORE;
            else if (r < 0.012) block = BLOCK.IRON_ORE;
            else if (r < 0.03) block = BLOCK.COAL_ORE;
            else if (r < 0.04) block = BLOCK.GRAVEL;
          }
          this._set(ch, x, y, z, block);
        }
        // carve caves out of the stone with 3D noise (winding tunnels +
        // occasional caverns); deep carved cells become lava.
        for (let y = 2; y < height - 3; y++) {
          const b = ch.blocks[this._idx(x, y, z)];
          if (b !== BLOCK.STONE && b !== BLOCK.GRAVEL) continue;   // keep ores as veins
          const tunnel = Math.abs(this.noise.fbm3(wx, y * 1.4, wz, 3, 0.5, 0.055) - 0.5) < 0.05;
          const cavern = this.noise.fbm3(wx + 500, y * 1.3, wz - 500, 3, 0.5, 0.04) > 0.84;
          if (tunnel || cavern) this._set(ch, x, y, z, y <= 3 ? BLOCK.LAVA : BLOCK.AIR);
        }
        // water fill
        for (let y = height + 1; y <= SEA_LEVEL; y++) this._set(ch, x, y, z, BLOCK.WATER);

        // foliage / trees on grassy land
        const isGrassTop = height >= SEA_LEVEL + 1 && height <= SEA_LEVEL + 17;
        if (isGrassTop && x >= 2 && x <= 13 && z >= 2 && z <= 13 && rnd() < 0.02) {
          this._tree(ch, x, height + 1, z, rnd);
        } else if (isGrassTop && rnd() < 0.18) {
          this._set(ch, x, height + 1, z, BLOCK.TALL_GRASS);   // seeds source
        }
      }
    }

    // structures (one decision per chunk, kept within bounds)
    if (rnd() < 0.04) this._ruin(ch, cx, cz, 4 + (rnd() * 7 | 0), 4 + (rnd() * 7 | 0), rnd);
    if (rnd() < 0.06) this._dungeon(ch, cx, cz, 4 + (rnd() * 7 | 0), 4 + (rnd() * 7 | 0), 8 + (rnd() * 18 | 0), rnd);
    if (this.genVersion >= 2) this._maybeStronghold(cx, cz, ch);
  }

  // Deterministic stronghold anchors (3 in a ring around origin). Shared with
  // the eye-of-ender locator so thrown eyes point to a real portal room.
  strongholds() {
    if (this.type !== 'regular' && this.type !== 'simple') return [];
    if (this.genVersion < 2) return [];
    if (this._strongholdCache) return this._strongholdCache;
    const r = mulberry32((this.seed ^ 0x5deece6d) >>> 0);
    const list = [];
    const ring = 96 + Math.floor(r() * 64);          // 96..160 blocks from spawn
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (r() - 0.5) * 0.8;
      list.push({ x: Math.round(Math.cos(a) * ring), z: Math.round(Math.sin(a) * ring) });
    }
    this._strongholdCache = list;
    return list;
  }

  _maybeStronghold(cx, cz, ch) {
    for (const s of this.strongholds()) {
      if (Math.floor(s.x / CHUNK) !== cx || Math.floor(s.z / CHUNK) !== cz) continue;
      let lx = s.x - cx * CHUNK, lz = s.z - cz * CHUNK;
      lx = Math.max(3, Math.min(CHUNK - 4, lx));     // keep the room inside this chunk
      lz = Math.max(3, Math.min(CHUNK - 4, lz));
      this._portalRoom(ch, cx, cz, lx, lz);
    }
  }

  // The stronghold's End-portal room: a stone-brick chamber with 12 empty
  // End-portal frames ringing a 3x3 centre, a loot chest, and a shaft to dig down.
  _portalRoom(ch, cx, cz, lx, lz) {
    const surf = this._localSurface(ch, lx, lz);
    let fy = Math.min((surf < 0 ? SEA_LEVEL : surf) - 9, SEA_LEVEL - 6);
    if (fy < 8) fy = 8;
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        this._set(ch, lx + dx, fy - 1, lz + dz, BLOCK.STONE_BRICK);         // floor
        for (let dy = 0; dy <= 4; dy++) {
          const wall = Math.abs(dx) === 3 || Math.abs(dz) === 3 || dy === 4;
          this._set(ch, lx + dx, fy + dy, lz + dz, wall ? BLOCK.STONE_BRICK : BLOCK.AIR);
        }
      }
    // 12 End-portal frames around the central 3x3 (corners stay open)
    for (let d = -1; d <= 1; d++) {
      this._set(ch, lx - 2, fy, lz + d, BLOCK.END_PORTAL_FRAME);
      this._set(ch, lx + 2, fy, lz + d, BLOCK.END_PORTAL_FRAME);
      this._set(ch, lx + d, fy, lz - 2, BLOCK.END_PORTAL_FRAME);
      this._set(ch, lx + d, fy, lz + 2, BLOCK.END_PORTAL_FRAME);
    }
    // loot chest in a corner of the chamber
    this._set(ch, lx - 2, fy, lz - 2, BLOCK.CHEST);
    this.lootChests.push({ x: cx * CHUNK + lx - 2, y: fy, z: cz * CHUNK + lz - 2, items: this._strongholdLoot() });
    // a 1x1 shaft straight up so the player can drop in once they dig the top block
    const topY = surf < 0 ? HEIGHT - 1 : surf;
    this._set(ch, lx, fy + 4, lz, BLOCK.AIR);
    for (let y = fy + 5; y < topY; y++) this._set(ch, lx, y, lz, BLOCK.AIR);
  }

  _strongholdLoot() {
    const r = mulberry32((this.seed ^ 0x1d872b41) >>> 0);
    const items = {};
    const pool = [[ITEM.ENDER_PEARL, 2], [ITEM.IRON_INGOT, 3], [ITEM.GOLD_INGOT, 2],
      [ITEM.DIAMOND, 1], [ITEM.BREAD, 3], [BLOCK.OBSIDIAN, 2]];
    const n = 3 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) { const [id, max] = pool[(r() * pool.length) | 0]; items[id] = (items[id] || 0) + (1 + (r() * max | 0)); }
    items[ITEM.ENDER_PEARL] = (items[ITEM.ENDER_PEARL] || 0) + 1 + (r() * 2 | 0);   // always a couple of pearls
    return items;
  }

  // top solid block height within this chunk at local (lx,lz)
  _localSurface(ch, lx, lz) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const b = ch.blocks[this._idx(lx, y, lz)];
      if (b !== BLOCK.AIR && BLOCK_INFO[b] && BLOCK_INFO[b].solid) return y;
    }
    return -1;
  }

  // random loot for a structure chest
  _loot(rnd) {
    const items = {};
    const pool = [
      [BLOCK.COBBLE, 8], [ITEM.COAL, 4], [ITEM.IRON_INGOT, 3], [ITEM.BREAD, 2],
      [ITEM.WHEAT_SEEDS, 3], [BLOCK.SAPLING, 1], [ITEM.GOLD_INGOT, 2], [ITEM.DIAMOND, 1],
      [ITEM.I_PICK, 1], [BLOCK.TORCH, 4], [BLOCK.PLANK, 6],
    ];
    const count = 2 + (rnd() * 3 | 0);
    for (let i = 0; i < count; i++) {
      const [id, max] = pool[(rnd() * pool.length) | 0];
      items[id] = (items[id] || 0) + (1 + (rnd() * max | 0));
    }
    return items;
  }

  // surface ruin: a small broken cobblestone shelter with a loot chest
  _ruin(ch, cx, cz, lx, lz, rnd) {
    const surf = this._localSurface(ch, lx, lz);
    if (surf < SEA_LEVEL || surf > HEIGHT - 8) return;   // skip underwater / peaks
    // require the whole footprint to be flat-ish land (no shoreline floats)
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const s = this._localSurface(ch, lx + dx, lz + dz);
        if (s < SEA_LEVEL || Math.abs(s - surf) > 1) return;
        const top = ch.blocks[this._idx(lx + dx, s, lz + dz)];
        if (top === BLOCK.WATER || top === BLOCK.SAND) return;   // not on water/beach
      }
    const base = surf + 1;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        this._set(ch, lx + dx, base - 1, lz + dz, BLOCK.COBBLE);   // floor
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        if (edge) for (let h = 0; h < 3; h++) {
          if (rnd() < 0.7) this._set(ch, lx + dx, base + h, lz + dz, rnd() < 0.4 ? BLOCK.MOSSY_COBBLE : BLOCK.COBBLE);
        }
      }
    this._set(ch, lx, base, lz, BLOCK.CHEST);
    this.lootChests.push({ x: cx * CHUNK + lx, y: base, z: cz * CHUNK + lz, items: this._loot(rnd) });
  }

  // underground dungeon: a hollow mossy room with a loot chest
  _dungeon(ch, cx, cz, lx, lz, ly, rnd) {
    if (ly < 6 || ly > HEIGHT - 12) return;
    // must be safely underground (room top below the surface) so it can't float
    const surf = this._localSurface(ch, lx, lz);
    if (surf < 0 || ly + 4 > surf) return;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -1; dy <= 3; dy++) {
          const shell = Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === -1 || dy === 3;
          if (shell) this._set(ch, lx + dx, ly + dy, lz + dz, rnd() < 0.45 ? BLOCK.MOSSY_COBBLE : BLOCK.COBBLE);
          else this._set(ch, lx + dx, ly + dy, lz + dz, BLOCK.AIR);
        }
    this._set(ch, lx, ly, lz, BLOCK.CHEST);
    this.lootChests.push({ x: cx * CHUNK + lx, y: ly, z: cz * CHUNK + lz, items: this._loot(rnd) });
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

  // Grow a tree at runtime (from a sapling). Uses setBlock so it persists as
  // edits and remeshes; only overwrites air/leaves so it won't gouge builds.
  placeTree(wx, wy, wz) {
    const h = 4 + (Math.random() * 2 | 0);
    const soft = (b) => b === BLOCK.AIR || b === BLOCK.SAPLING || b === BLOCK.LEAVES;
    for (let i = 0; i < h; i++) if (soft(this.getBlock(wx, wy + i, wz))) this.setBlock(wx, wy + i, wz, BLOCK.WOOD, false);
    const top = wy + h;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -2; dy <= 0; dy++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (dy === 0 && dx === 0 && dz === 0) continue;
          if (this.getBlock(wx + dx, top + dy, wz + dz) === BLOCK.AIR) this.setBlock(wx + dx, top + dy, wz + dz, BLOCK.LEAVES, false);
        }
    if (this.getBlock(wx, top, wz) === BLOCK.AIR) this.setBlock(wx, top, wz, BLOCK.LEAVES, false);
    if (this.getBlock(wx, top + 1, wz) === BLOCK.AIR) this.setBlock(wx, top + 1, wz, BLOCK.LEAVES, false);
    this.remeshArea(wx - 2, wx + 2, wz - 2, wz + 2);
  }

  // The Nether: netherrack floor with lava lakes, a netherrack ceiling,
  // glowstone clusters, and bedrock caps top & bottom.
  _genNether(cx, cz, ch) {
    const rnd = mulberry32((this.seed ^ (cx * 19349663) ^ (cz * 83492791)) >>> 0);
    const CEIL = 46, FLOOR_LAVA = 14;
    for (let x = 0; x < CHUNK; x++) {
      for (let z = 0; z < CHUNK; z++) {
        const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
        const h = Math.floor(18 + this.noise.fbm(wx, wz, 3, 0.5, 0.05) * 12);  // floor height ~18-30
        for (let y = 0; y <= h; y++) {
          let block = BLOCK.NETHERRACK;
          if (y === 0) block = BLOCK.BEDROCK;
          this._set(ch, x, y, z, block);
        }
        // lava lakes in low pockets
        for (let y = h + 1; y <= FLOOR_LAVA; y++) this._set(ch, x, y, z, BLOCK.LAVA);
        // ceiling
        for (let y = CEIL; y < HEIGHT; y++) {
          this._set(ch, x, y, z, y === HEIGHT - 1 ? BLOCK.BEDROCK : BLOCK.NETHERRACK);
        }
        // glowstone clusters hanging from the ceiling
        if (rnd() < 0.02) {
          const len = 1 + (rnd() * 3 | 0);
          for (let i = 0; i < len; i++) this._set(ch, x, CEIL - 1 - i, z, BLOCK.GLOWSTONE);
        }
      }
    }
    // nether-brick fortress segment (with a blaze-rod loot chest)
    if (this.genVersion >= 2 && rnd() < 0.05) this._fortress(ch, cx, cz, rnd);
  }

  // A raised nether-brick walkway with corner pillars and a loot chest. Blazes
  // are spawned near it by the game when the player is close.
  _fortress(ch, cx, cz, rnd) {
    const lx = 4 + (rnd() * 6 | 0), lz = 4 + (rnd() * 6 | 0), fy = 28;
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        this._set(ch, lx + dx, fy, lz + dz, BLOCK.NETHER_BRICK);            // floor
        if (Math.abs(dx) === 3 || Math.abs(dz) === 3) this._set(ch, lx + dx, fy + 1, lz + dz, BLOCK.NETHER_BRICK);  // rail
      }
    for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]])
      for (let h = 1; h <= 3; h++) this._set(ch, lx + px, fy + h, lz + pz, BLOCK.NETHER_BRICK);   // pillars
    this._set(ch, lx, fy + 1, lz, BLOCK.CHEST);
    this.lootChests.push({ x: cx * CHUNK + lx, y: fy + 1, z: cz * CHUNK + lz, items: this._fortressLoot(rnd) });
  }

  _fortressLoot(rnd) {
    const items = {};
    const pool = [[ITEM.BLAZE_ROD, 2], [ITEM.GOLD_INGOT, 3], [ITEM.IRON_INGOT, 2], [ITEM.DIAMOND, 1]];
    const n = 2 + (rnd() * 3 | 0);
    for (let i = 0; i < n; i++) { const [id, max] = pool[(rnd() * pool.length) | 0]; items[id] = (items[id] || 0) + (1 + (rnd() * max | 0)); }
    items[ITEM.BLAZE_ROD] = (items[ITEM.BLAZE_ROD] || 0) + 1 + (rnd() * 2 | 0);   // guarantee blaze rods
    return items;
  }

  // ---- dimension visibility (overworld <-> nether) ----
  hide() {
    for (const [, ch] of this.chunks) {
      if (ch.mesh) this.scene.remove(ch.mesh);
      if (ch.tmesh) this.scene.remove(ch.tmesh);
    }
  }
  show() {
    for (const [, ch] of this.chunks) {
      if (ch.mesh) this.scene.add(ch.mesh);
      if (ch.tmesh) this.scene.add(ch.tmesh);
    }
  }

  // ---- lighting ----
  // Compute skylight + blocklight for a chunk over a 1-block padded domain.
  // Returns a lookup: lightAt(wx, wy, wz) -> [sky0..1, block0..1].
  _computeLight(cx, cz) {
    const PAD = 1, W = CHUNK + PAD * 2;
    const ox = cx * CHUNK - PAD, oz = cz * CHUNK - PAD;
    const sky = new Uint8Array(W * HEIGHT * W);
    const blk = new Uint8Array(W * HEIGHT * W);
    const li = (lx, y, lz) => (y * W + lz) * W + lx;
    const netherBase = this.type === 'nether' ? 6 : 0;

    // skylight: seed cells open to the sky, then flood
    const qx = [], qy = [], qz = [];
    for (let lx = 0; lx < W; lx++) {
      for (let lz = 0; lz < W; lz++) {
        const wx = ox + lx, wz = oz + lz;
        let open = this.type !== 'nether';
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const b = this.getBlock(wx, y, wz);
          if (!lightPasses(b)) { open = false; continue; }
          const v = open ? 15 : netherBase;
          if (v > 0) { sky[li(lx, y, lz)] = v; qx.push(lx); qy.push(y); qz.push(lz); }
        }
      }
    }
    this._floodLight(sky, qx, qy, qz, ox, oz, W, li);

    // blocklight: seed emitters, then flood
    const ex = [], ey = [], ez = [];
    for (let lx = 0; lx < W; lx++)
      for (let lz = 0; lz < W; lz++)
        for (let y = 0; y < HEIGHT; y++) {
          const e = blockEmit(this.getBlock(ox + lx, y, oz + lz));
          if (e > 0) { blk[li(lx, y, lz)] = e; ex.push(lx); ey.push(y); ez.push(lz); }
        }
    this._floodLight(blk, ex, ey, ez, ox, oz, W, li);

    return (wx, wy, wz) => {
      const lx = wx - ox, lz = wz - oz, y = Math.max(0, Math.min(HEIGHT - 1, wy));
      if (lx < 0 || lx >= W || lz < 0 || lz >= W) return [netherBase / 15, 0];
      const i = li(lx, y, lz);
      return [sky[i] / 15, blk[i] / 15];
    };
  }

  _floodLight(arr, qx, qy, qz, ox, oz, W, li) {
    const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    let head = 0;
    while (head < qx.length) {
      const lx = qx[head], y = qy[head], lz = qz[head]; head++;
      const v = arr[li(lx, y, lz)];
      if (v <= 1) continue;
      for (const n of N) {
        const nlx = lx + n[0], ny = y + n[1], nlz = lz + n[2];
        if (nlx < 0 || nlx >= W || nlz < 0 || nlz >= W || ny < 0 || ny >= HEIGHT) continue;
        if (!lightPasses(this.getBlock(ox + nlx, ny, oz + nlz))) continue;
        const ni = li(nlx, ny, nlz);
        if (arr[ni] < v - 1) { arr[ni] = v - 1; qx.push(nlx); qy.push(ny); qz.push(nlz); }
      }
    }
  }

  // ---- meshing ----
  buildMesh(cx, cz) {
    const ch = this.chunks.get(this.key(cx, cz));
    if (!ch) return;

    const pos = [], col = [], uv = [], lgt = [], idx = [];
    const tpos = [], tcol = [], tuv = [], tlgt = [], tidx = [];
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const maxY = Math.min(ch.maxY + 1, HEIGHT - 1);
    const lightAt = this._computeLight(cx, cz);

    for (let y = 0; y <= maxY; y++) {
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const b = ch.blocks[this._idx(x, y, z)];
          if (b === BLOCK.AIR) continue;
          if (MODEL_BLOCKS.has(b)) continue;   // drawn as a 3D model, not a cube
          const bInfo = BLOCK_INFO[b];
          const isT = (b === BLOCK.WATER || b === BLOCK.GLASS || b === BLOCK.PORTAL || b === BLOCK.AETHER_PORTAL || (bInfo && (bInfo.crop || bInfo.rs)));
          const wx = ox + x, wz = oz + z;

          for (const d of DIRS) {
            const nb = this.getBlock(wx + d.n[0], y + d.n[1], wz + d.n[2]);
            const nInfo = BLOCK_INFO[nb];
            if (nb !== BLOCK.AIR && nInfo && !nInfo.transparent) continue;
            if (nb !== BLOCK.AIR && nInfo && nInfo.transparent && nb === b) continue;

            const P = isT ? tpos : pos, C = isT ? tcol : col,
                  U = isT ? tuv : uv, L = isT ? tlgt : lgt, I = isT ? tidx : idx;
            const start = P.length / 3;
            const uvr = faceUV(b, d.face);
            const br = d.bright;
            const lt = lightAt(wx + d.n[0], y + d.n[1], wz + d.n[2]);   // light of the air side
            for (let c = 0; c < 4; c++) {
              const cc = d.corners[c];
              P.push(x + cc[0], y + cc[1], z + cc[2]);
              C.push(br, br, br);
              L.push(lt[0], lt[1]);
            }
            U.push(uvr[0], uvr[1], uvr[2], uvr[1], uvr[2], uvr[3], uvr[0], uvr[3]);
            I.push(start, start + 1, start + 2, start, start + 2, start + 3);
          }
        }
      }
    }

    if (ch.mesh) { ch.mesh.geometry.dispose(); this.scene.remove(ch.mesh); ch.mesh = null; }
    if (ch.tmesh) { ch.tmesh.geometry.dispose(); this.scene.remove(ch.tmesh); ch.tmesh = null; }

    if (pos.length) {
      ch.mesh = this._makeMesh(pos, col, uv, lgt, idx, this.material);
      ch.mesh.position.set(ox, 0, oz);
      this.scene.add(ch.mesh);
    }
    if (tpos.length) {
      ch.tmesh = this._makeMesh(tpos, tcol, tuv, tlgt, tidx, this.tMaterial);
      ch.tmesh.position.set(ox, 0, oz);
      this.scene.add(ch.tmesh);
    }
  }

  _makeMesh(pos, col, uv, lgt, idx, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('light', new THREE.Float32BufferAttribute(lgt, 2));
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

  // find the floor (top of first solid) scanning DOWN from fromY — used in the
  // Nether, where surfaceY would land on the ceiling.
  floorY(wx, wz, fromY = 40) {
    for (let y = Math.min(fromY, HEIGHT - 1); y >= 0; y--) {
      if (this.isSolid(wx, y, wz) && !this.isSolid(wx, y + 1, wz)) return y + 1;
    }
    return 2;
  }

  // ---- save / load (only post-generation edits are persisted) ----
  serializeEdits() {
    const out = [];
    for (const [k, id] of this.edits) {
      const p = k.split(',');
      out.push(+p[0], +p[1], +p[2], id);   // flat [x,y,z,id, ...]
    }
    return out;
  }
  loadEdits(flat) {
    if (!flat) return;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const x = flat[i], y = flat[i + 1], z = flat[i + 2], id = flat[i + 3];
      this.ensureChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
      this.setBlock(x, y, z, id, false);   // write data; meshes built on stream
    }
  }

  // rebuild meshes covering a world-space box (plus a one-chunk margin).
  remeshArea(wxMin, wxMax, wzMin, wzMax) {
    const cx0 = Math.floor(wxMin / CHUNK) - 1, cx1 = Math.floor(wxMax / CHUNK) + 1;
    const cz0 = Math.floor(wzMin / CHUNK) - 1, cz1 = Math.floor(wzMax / CHUNK) + 1;
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++)
        if (this.chunks.has(this.key(cx, cz))) this.buildMesh(cx, cz);
  }
}
