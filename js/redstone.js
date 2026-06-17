// Redstone power simulation: dust (signal decay), sources (redstone block,
// lever, button, redstone torch with NOT-gate inversion), outputs (lamp),
// repeaters (directional diode) and pistons (push/pull one block).
// Globals from earlier scripts: BLOCK, BLOCK_INFO, HEIGHT.

const rsFacing = new Map();          // "x,y,z" -> 'n'|'s'|'e'|'w' (pistons/repeaters/comparators)
const rsCompSub = new Set();         // comparator positions in subtract mode
const RS_DIR = { n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };
const RS_N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function rsKey(x, y, z) { return x + ',' + y + ',' + z; }

function isRS(id) { return id >= BLOCK.REDSTONE_DUST && id <= BLOCK.COMPARATOR_ON; }
function facingFromYaw(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 'e' : 'w';
  return fz > 0 ? 's' : 'n';
}
// run the sim only if there's redstone in/around the cell (cheap gate)
function maybeUpdateRedstone(world, x, y, z) {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        if (isRS(world.getBlock(x + dx, y + dy, z + dz))) { updateRedstone(world, x, y, z); return; }
}

function rsPushable(id) {
  if (id === BLOCK.AIR || id === BLOCK.BEDROCK) return false;
  if (id === BLOCK.PISTON || id === BLOCK.PISTON_STICKY || id === BLOCK.PISTON_HEAD) return false;
  return !!(BLOCK_INFO[id] && BLOCK_INFO[id].solid);
}

// Recompute power & components in a box around (cx,cy,cz) using a strong/weak
// power model (so dust->block->torch logic chains work). Mutates output block
// ids; returns true if anything visually changed.
function updateRedstone(world, cx, cy, cz, R) {
  R = R || 14;
  const x0 = cx - R, x1 = cx + R, y0 = Math.max(1, cy - R), y1 = Math.min(HEIGHT - 1, cy + R), z0 = cz - R, z1 = cz + R;
  const at = (x, y, z) => world.getBlock(x, y, z);
  const dirAt = (x, y, z) => RS_DIR[rsFacing.get(rsKey(x, y, z)) || 'n'];

  const dust = [], torch = [], reps = [], comps = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const b = at(x, y, z);
        if (b === BLOCK.REDSTONE_DUST) dust.push([x, y, z]);
        else if (b === BLOCK.REDSTONE_TORCH || b === BLOCK.REDSTONE_TORCH_OFF) torch.push([x, y, z]);
        else if (b === BLOCK.REPEATER || b === BLOCK.REPEATER_ON) reps.push([x, y, z]);
        else if (b === BLOCK.COMPARATOR || b === BLOCK.COMPARATOR_ON) comps.push([x, y, z]);
      }

  const dustPow = new Map(), torchOn = new Map(), repOn = new Map(), compOut = new Map();
  for (const [x, y, z] of torch) torchOn.set(rsKey(x, y, z), at(x, y, z) === BLOCK.REDSTONE_TORCH);
  for (const [x, y, z] of reps) repOn.set(rsKey(x, y, z), at(x, y, z) === BLOCK.REPEATER_ON);
  for (const [x, y, z] of comps) compOut.set(rsKey(x, y, z), at(x, y, z) === BLOCK.COMPARATOR_ON ? 1 : 0);

  // strong power of a solid block (transmits 15 to adjacent dust)
  const strongPower = (x, y, z) => {
    let s = 0;
    const bel = at(x, y - 1, z);
    if ((bel === BLOCK.REDSTONE_TORCH || bel === BLOCK.REDSTONE_TORCH_OFF) && torchOn.get(rsKey(x, y - 1, z))) s = 15;
    for (const n of RS_N6) {
      const nx = x + n[0], ny = y + n[1], nz = z + n[2], nb = at(nx, ny, nz);
      if (nb === BLOCK.REPEATER || nb === BLOCK.REPEATER_ON) { const d = dirAt(nx, ny, nz); if (repOn.get(rsKey(nx, ny, nz)) && nx + d[0] === x && ny + d[1] === y && nz + d[2] === z) s = 15; }
      else if (nb === BLOCK.COMPARATOR || nb === BLOCK.COMPARATOR_ON) { const d = dirAt(nx, ny, nz); if (nx + d[0] === x && ny + d[1] === y && nz + d[2] === z) s = Math.max(s, compOut.get(rsKey(nx, ny, nz)) || 0); }
    }
    return s;
  };
  // signal supplied from cell (fx,fy,fz) into adjacent target (tx,ty,tz)
  const signalInto = (tx, ty, tz, fx, fy, fz) => {
    const b = at(fx, fy, fz), k = rsKey(fx, fy, fz);
    if (b === BLOCK.REDSTONE_DUST) return dustPow.get(k) || 0;
    if (b === BLOCK.REDSTONE_BLOCK || b === BLOCK.LEVER_ON || b === BLOCK.BUTTON_ON) return 15;
    if (b === BLOCK.REDSTONE_TORCH || b === BLOCK.REDSTONE_TORCH_OFF) return torchOn.get(k) ? 15 : 0;
    if (b === BLOCK.REPEATER || b === BLOCK.REPEATER_ON) { const d = dirAt(fx, fy, fz); return (repOn.get(k) && fx + d[0] === tx && fy + d[1] === ty && fz + d[2] === tz) ? 15 : 0; }
    if (b === BLOCK.COMPARATOR || b === BLOCK.COMPARATOR_ON) { const d = dirAt(fx, fy, fz); return (fx + d[0] === tx && fy + d[1] === ty && fz + d[2] === tz) ? (compOut.get(k) || 0) : 0; }
    if (BLOCK_INFO[b] && BLOCK_INFO[b].solid) return strongPower(fx, fy, fz);
    return 0;
  };
  // is a solid block powered (lights lamps, turns off torches, drives pistons)?
  const blockPowered = (x, y, z) => {
    if (strongPower(x, y, z) > 0) return true;
    for (const n of RS_N6) {
      const nx = x + n[0], ny = y + n[1], nz = z + n[2], nb = at(nx, ny, nz);
      if (nb === BLOCK.REDSTONE_BLOCK || nb === BLOCK.LEVER_ON || nb === BLOCK.BUTTON_ON) return true;
      if (nb === BLOCK.REDSTONE_DUST && (dustPow.get(rsKey(nx, ny, nz)) || 0) > 0) return true;
      // a torch weakly powers neighbours EXCEPT the block it sits on
      if ((nb === BLOCK.REDSTONE_TORCH || nb === BLOCK.REDSTONE_TORCH_OFF) && torchOn.get(rsKey(nx, ny, nz)) && !(nx === x && ny - 1 === y && nz === z)) return true;
    }
    return false;
  };

  for (let iter = 0; iter < 16; iter++) {
    let changed = false;
    // 1. dust power: seed from non-dust sources, then BFS decay
    const np = new Map(); const q = [];
    for (const [x, y, z] of dust) {
      let p = 0;
      for (const n of RS_N6) {
        const nx = x + n[0], ny = y + n[1], nz = z + n[2];
        if (at(nx, ny, nz) === BLOCK.REDSTONE_DUST) continue;
        const s = signalInto(x, y, z, nx, ny, nz);
        if (s > p) p = s;
      }
      np.set(rsKey(x, y, z), p); if (p > 0) q.push([x, y, z]);
    }
    let head = 0;
    while (head < q.length) {
      const [x, y, z] = q[head++]; const p = np.get(rsKey(x, y, z));
      if (p <= 1) continue;
      for (const n of RS_N6) {
        const nx = x + n[0], ny = y + n[1], nz = z + n[2];
        if (at(nx, ny, nz) !== BLOCK.REDSTONE_DUST) continue;
        const nk = rsKey(nx, ny, nz);
        if ((np.get(nk) || 0) < p - 1) { np.set(nk, p - 1); q.push([nx, ny, nz]); }
      }
    }
    for (const [k, v] of np) if ((dustPow.get(k) || 0) !== v) changed = true;
    dustPow.clear(); for (const [k, v] of np) dustPow.set(k, v);
    // 2. torches: off when their support block (below) is powered
    for (const [x, y, z] of torch) {
      const on = !blockPowered(x, y - 1, z);
      if (torchOn.get(rsKey(x, y, z)) !== on) { torchOn.set(rsKey(x, y, z), on); changed = true; }
    }
    // 3. repeaters: on when the block behind them is powered (one-way diode)
    for (const [x, y, z] of reps) {
      const d = dirAt(x, y, z);
      const on = signalInto(x, y, z, x - d[0], y - d[1], z - d[2]) > 0;
      if (repOn.get(rsKey(x, y, z)) !== on) { repOn.set(rsKey(x, y, z), on); changed = true; }
    }
    // 4. comparators: compare / subtract back vs. the stronger side input
    for (const [x, y, z] of comps) {
      const d = dirAt(x, y, z);
      const back = signalInto(x, y, z, x - d[0], y - d[1], z - d[2]);
      const s1 = signalInto(x, y, z, x + d[2], y, z + d[0]);   // perpendicular sides
      const s2 = signalInto(x, y, z, x - d[2], y, z - d[0]);
      const side = Math.max(s1, s2);
      const out = rsCompSub.has(rsKey(x, y, z)) ? Math.max(0, back - side) : (back >= side ? back : 0);
      if ((compOut.get(rsKey(x, y, z)) || 0) !== out) { compOut.set(rsKey(x, y, z), out); changed = true; }
    }
    if (!changed) break;
  }

  // apply outputs
  const changed = [];
  const setIf = (x, y, z, id) => { if (at(x, y, z) !== id) { world.setBlock(x, y, z, id, false); changed.push([x, y, z]); } };
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const b = at(x, y, z);
        if (b === BLOCK.REDSTONE_LAMP || b === BLOCK.REDSTONE_LAMP_ON) setIf(x, y, z, blockPowered(x, y, z) ? BLOCK.REDSTONE_LAMP_ON : BLOCK.REDSTONE_LAMP);
        else if (b === BLOCK.REDSTONE_TORCH || b === BLOCK.REDSTONE_TORCH_OFF) setIf(x, y, z, torchOn.get(rsKey(x, y, z)) ? BLOCK.REDSTONE_TORCH : BLOCK.REDSTONE_TORCH_OFF);
        else if (b === BLOCK.REPEATER || b === BLOCK.REPEATER_ON) setIf(x, y, z, repOn.get(rsKey(x, y, z)) ? BLOCK.REPEATER_ON : BLOCK.REPEATER);
        else if (b === BLOCK.COMPARATOR || b === BLOCK.COMPARATOR_ON) setIf(x, y, z, (compOut.get(rsKey(x, y, z)) || 0) > 0 ? BLOCK.COMPARATOR_ON : BLOCK.COMPARATOR);
      }
  // 4. pistons
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const b = world.getBlock(x, y, z);
        if (b !== BLOCK.PISTON && b !== BLOCK.PISTON_STICKY) continue;
        const d = RS_DIR[rsFacing.get(rsKey(x, y, z)) || 's'];
        const hx = x + d[0], hy = y + d[1], hz = z + d[2];
        if (hy < 1 || hy >= HEIGHT) continue;
        const powered = blockPowered(x, y, z);
        const extended = world.getBlock(hx, hy, hz) === BLOCK.PISTON_HEAD;
        if (powered && !extended) {
          const front = world.getBlock(hx, hy, hz);
          if (front !== BLOCK.AIR) {
            const px = hx + d[0], py = hy + d[1], pz = hz + d[2];
            if (py < 1 || py >= HEIGHT || world.getBlock(px, py, pz) !== BLOCK.AIR || !rsPushable(front)) continue;
            world.setBlock(px, py, pz, front, false); changed.push([px, py, pz]);
          }
          world.setBlock(hx, hy, hz, BLOCK.PISTON_HEAD, false); changed.push([hx, hy, hz]);
        } else if (!powered && extended) {
          world.setBlock(hx, hy, hz, BLOCK.AIR, false); changed.push([hx, hy, hz]);
          if (b === BLOCK.PISTON_STICKY) {
            const px = hx + d[0], py = hy + d[1], pz = hz + d[2];
            const pb = world.getBlock(px, py, pz);
            if (pb !== BLOCK.AIR && rsPushable(pb)) { world.setBlock(px, py, pz, BLOCK.AIR, false); world.setBlock(hx, hy, hz, pb, false); changed.push([px, py, pz]); }
          }
        }
      }

  if (changed.length) {
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const [x, , z] of changed) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (z < mnz) mnz = z; if (z > mxz) mxz = z; }
    world.remeshArea(mnx, mxx, mnz, mxz);
  }
  return changed.length > 0;
}
