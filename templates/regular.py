"""Regular world — natural terrain with hills, caves, trees, and ores."""

import math
import random
from typing import List

from blocks import Block
from config import SEA_LEVEL
from templates import WorldTemplate


class RegularTemplate(WorldTemplate):
    name        = "Regular"
    description = "Natural terrain: hills, caves, trees, and underground ores."

    def generate(self, width: int, height: int, seed: int) -> List[List[int]]:
        rng   = random.Random(seed)
        grid  = [[Block.AIR] * width for _ in range(height)]
        heights = self._heightmap(width, seed, base=SEA_LEVEL, amplitude=18)

        for x in range(width):
            sy = heights[x]
            for y in range(height):
                if y >= height - 1:
                    grid[y][x] = Block.BEDROCK
                elif y == sy:
                    grid[y][x] = Block.GRASS
                elif sy < y <= sy + 4:
                    grid[y][x] = Block.DIRT
                elif y > sy + 4:
                    grid[y][x] = Block.STONE
                elif y > SEA_LEVEL and grid[y][x] == Block.AIR:
                    grid[y][x] = Block.WATER   # fill below sea level

            # Water fill pass (air below sea)
            for y in range(height):
                if grid[y][x] == Block.AIR and y > SEA_LEVEL:
                    grid[y][x] = Block.WATER

            # Sparse trees on land above sea
            if rng.random() < 0.035 and sy < SEA_LEVEL - 2:
                self._place_tree(grid, x, sy - 1, width, height, rng)

        self._place_ores(grid, width, height, rng)
        self._carve_caves(grid, width, height, rng)
        return grid

    # ── helpers ──────────────────────────────────────────────────────────────

    def _heightmap(self, width: int, seed: float, base: int, amplitude: int):
        out = []
        for x in range(width):
            h  = base
            h += amplitude       * math.sin(x * 0.040 + seed)
            h += amplitude * 0.5 * math.sin(x * 0.091 + seed * 1.31)
            h += amplitude * 0.25* math.sin(x * 0.197 + seed * 0.74)
            out.append(max(10, min(int(h), height - 5)) if False else int(h))
        return out

    def _place_tree(self, grid, x, base_y, width, height, rng):
        trunk = rng.randint(4, 6)
        for ty in range(trunk):
            gy = base_y - ty
            if 0 <= gy < height:
                grid[gy][x] = Block.OAK_LOG
        top = base_y - trunk
        for ly in range(top - 2, top + 2):
            for lx in range(x - 2, x + 3):
                if 0 <= ly < height and 0 <= lx < width:
                    if grid[ly][lx] == Block.AIR:
                        grid[ly][lx] = Block.OAK_LEAVES

    def _place_ores(self, grid, width, height, rng):
        specs = [
            (Block.COAL_ORE,    0.016, int(height * 0.50), height - 6),
            (Block.IRON_ORE,    0.011, int(height * 0.60), height - 6),
            (Block.GOLD_ORE,    0.005, int(height * 0.75), height - 6),
            (Block.DIAMOND_ORE, 0.003, int(height * 0.88), height - 6),
        ]
        for ore, chance, min_y, max_y in specs:
            for y in range(min_y, max_y):
                for x in range(width):
                    if grid[y][x] == Block.STONE and rng.random() < chance:
                        grid[y][x] = ore

    def _carve_caves(self, grid, width, height, rng):
        num_caves = width // 6
        for _ in range(num_caves):
            cx   = rng.randint(8, width  - 8)
            cy   = rng.randint(int(height * 0.50), height - 10)
            size = rng.randint(3, 8)
            for dy in range(-size, size + 1):
                for dx in range(-size, size + 1):
                    if dx * dx + dy * dy <= size * size:
                        nx, ny = cx + dx, cy + dy
                        if 1 <= nx < width - 1 and 1 <= ny < height - 2:
                            if grid[ny][nx] not in (Block.BEDROCK, Block.WATER):
                                grid[ny][nx] = Block.AIR
