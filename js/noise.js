// Seeded pseudo-random + value noise with fractal octaves.
// Lightweight, dependency-free, deterministic from a numeric seed.

function hashSeed(str) {
  // Convert any string into a 32-bit numeric seed.
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Noise {
  constructor(seed) {
    this.seed = seed >>> 0;
  }

  // Deterministic hash for a 2D integer coordinate -> [0,1)
  _hash2(x, y) {
    let h = this.seed;
    h = Math.imul(h ^ (x | 0), 374761393);
    h = Math.imul(h ^ (y | 0), 668265263);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  _smooth(t) { return t * t * (3 - 2 * t); }

  // Smooth value noise at fractional (x, y)
  value2(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = this._smooth(x - x0), fy = this._smooth(y - y0);
    const v00 = this._hash2(x0, y0);
    const v10 = this._hash2(x0 + 1, y0);
    const v01 = this._hash2(x0, y0 + 1);
    const v11 = this._hash2(x0 + 1, y0 + 1);
    const top = v00 + (v10 - v00) * fx;
    const bot = v01 + (v11 - v01) * fx;
    return top + (bot - top) * fy;
  }

  // Fractal Brownian Motion: layered noise -> [0,1]
  fbm(x, y, octaves = 4, persistence = 0.5, scale = 0.01) {
    let total = 0, amplitude = 1, frequency = scale, max = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.value2(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }
    return total / max;
  }
}
