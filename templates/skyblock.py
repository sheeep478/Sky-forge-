"""Skyblock world — a small island floating in the void."""

from typing import List, Tuple

from blocks import Block
from templates import WorldTemplate


class SkyblockTemplate(WorldTemplate):
    name        = "Skyblock"
    description = "A tiny island floating in the void. Survive with nothing!"

    def generate(self, width: int, height: int, seed: int) -> List[List[int]]:
        grid = [[Block.AIR] * width for _ in range(height)]
        cx   = width  // 2
        cy   = height // 2

        # ── Main island (ellipse) ─────────────────────────────────────────
        for dy in range(-3, 4):
            for dx in range(-9, 10):
                if (dx / 9.0) ** 2 + (dy / 3.0) ** 2 <= 1.0:
                    y, x = cy + dy, cx + dx
                    if 0 <= y < height and 0 <= x < width:
                        grid[y][x] = Block.STONE if dy >= 0 else Block.DIRT

        # Grass cap
        for dx in range(-9, 10):
            if (dx / 9.0) ** 2 <= 1.0:
                y, x = cy - 3, cx + dx
                if 0 <= y < height and 0 <= x < width:
                    grid[y][x] = Block.GRASS

        # ── Starter tree ─────────────────────────────────────────────────
        tx      = cx - 2
        base_y  = cy - 4
        for ty in range(5):
            gy = base_y - ty
            if 0 <= gy < height:
                grid[gy][tx] = Block.OAK_LOG
        for ly in range(base_y - 7, base_y - 2):
            for lx in range(tx - 2, tx + 3):
                if 0 <= ly < height and 0 <= lx < width:
                    if grid[ly][lx] == Block.AIR:
                        grid[ly][lx] = Block.OAK_LEAVES

        # ── Bonus island (ore/resource chest-substitute) ──────────────────
        bx = cx + 24
        for dy in range(-1, 2):
            for dx in range(-3, 4):
                if (dx / 3.0) ** 2 + (dy / 1.5) ** 2 <= 1.0:
                    y, x = cy + dy, bx + dx
                    if 0 <= y < height and 0 <= x < width:
                        grid[y][x] = Block.STONE
        # Put a few ore blocks on the bonus island
        for ore, ox in [(Block.COAL_ORE, bx - 1), (Block.IRON_ORE, bx), (Block.GOLD_ORE, bx + 1)]:
            if 0 <= cy - 1 < height and 0 <= ox < width:
                grid[cy - 1][ox] = ore

        return grid

    def get_spawn(self, grid, width, height) -> Tuple[int, int]:
        cx = width  // 2
        cy = height // 2
        return (cx, cy - 5)
