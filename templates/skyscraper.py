"""Skyscraper world — recreation of the pink cherry-wood tower from the
player's Bedrock build: cherry plank frame, pink stained-glass walls, an
indoor wheat farm, balconies, a cantilevered room, an open beam frame on
top, a terraced low wing on the left, and a fenced bridge over the river.
Set in a cherry grove biome."""

import math
import random
from typing import List

from blocks import Block
from config import SEA_LEVEL
from templates import WorldTemplate


class SkyscraperTemplate(WorldTemplate):
    name        = "Skyscraper"
    description = "A pink cherry-wood skyscraper in a cherry grove biome."

    TOWER_HALF   = 6     # tower spans cx-6 .. cx+6 (13 wide)
    STORY_HEIGHT = 6     # 5 rows of wall + 1 floor slab
    NUM_STORIES  = 6     # lobby, farm, balcony, cantilever, penthouse, frame

    def generate(self, width: int, height: int, seed: int) -> List[List[int]]:
        rng  = random.Random(seed)
        grid = [[Block.AIR] * width for _ in range(height)]
        g    = SEA_LEVEL
        cx   = width // 2
        L    = cx - self.TOWER_HALF
        R    = cx + self.TOWER_HALF

        build_l, build_r = L - 22, R + 26
        river_l, river_r = R + 9, R + 16

        # ── Terrain: flat around the build, gentle hills beyond ─────────────
        for x in range(width):
            if build_l <= x <= build_r:
                sy = g
            else:
                sy = g + int(4 * math.sin(x * 0.045 + seed)
                             + 2 * math.sin(x * 0.11 + seed * 1.7))
            grid[sy][x] = Block.GRASS
            for y in range(sy + 1, sy + 4):
                grid[y][x] = Block.DIRT
            for y in range(sy + 4, height - 1):
                grid[y][x] = Block.STONE
            grid[height - 1][x] = Block.BEDROCK

        # ── River (crossed by the bridge on the right) ──────────────────────
        for x in range(river_l, river_r + 1):
            for y in range(g, g + 6):
                grid[y][x] = Block.WATER
            for y in range(g + 6, g + 9):
                grid[y][x] = Block.DIRT

        # ── Cherry trees scattered through the grove ────────────────────────
        for _ in range(width // 14):
            tx = rng.randint(4, width - 5)
            if build_l - 4 <= tx <= build_r + 4:
                continue
            ty = next((y for y in range(height) if grid[y][tx] == Block.GRASS),
                      None)
            if ty is not None:
                self._place_cherry_tree(grid, tx, ty - 1, width, height, rng)

        self._build_tower(grid, width, height, g, cx, L, R)
        self._build_wing(grid, g, L)
        self._build_bridge(grid, g, R, river_r)
        return grid

    # ── The tower itself ─────────────────────────────────────────────────────

    def _build_tower(self, grid, width, height, g, cx, L, R) -> None:
        P, GL = Block.CHERRY_PLANKS, Block.PINK_GLASS
        sh    = self.STORY_HEIGHT

        for story in range(self.NUM_STORIES):
            b = g - 1 - story * sh          # bottom wall row of this story
            t = b - (sh - 1)                # slab row capping this story

            # Corner pillars + slab (every story, incl. the open top frame)
            for y in range(t, b + 1):
                grid[y][L] = P
                grid[y][R] = P
            for x in range(L, R + 1):
                grid[t][x] = P

            if story == 5:
                # Open beam frame on top: no walls, one glass panel remnant
                for y in range(b - 1, b - 4, -1):
                    for x in range(cx + 2, R):
                        grid[y][x] = GL
                continue

            # Glass curtain wall between the pillars
            for y in range(t + 1, b + 1):
                for x in range(L + 1, R):
                    grid[y][x] = GL

            if story == 0:
                # Lobby: dark doorway, fence porch rails beside it
                for y in range(b, b - 3, -1):
                    grid[y][cx - 1] = Block.AIR
                    grid[y][cx]     = Block.AIR
                for x in (L + 2, L + 3, R - 3, R - 2):
                    grid[b][x] = Block.CHERRY_FENCE

            elif story == 1:
                # Indoor wheat farm behind the glass
                for x in range(L + 1, R):
                    grid[b][x]     = Block.DIRT
                    grid[b - 1][x] = Block.WHEAT

            elif story == 2:
                # Balcony on the left with fence railing
                for x in range(L - 3, L):
                    grid[b + 1][x] = P
                    grid[b][x]     = Block.CHERRY_FENCE

            elif story == 3:
                # Cantilevered room jutting out the right side
                for x in range(R + 1, R + 6):
                    grid[b + 1][x] = P          # floor
                    grid[b - 4][x] = P          # roof
                for y in range(b, b - 4, -1):
                    grid[y][R + 5] = P          # outer wall
                    for x in range(R + 1, R + 5):
                        grid[y][x] = GL

            elif story == 4:
                # Penthouse with a small left balcony
                for x in range(L - 2, L):
                    grid[b + 1][x] = P
                    grid[b][x]     = Block.CHERRY_FENCE

        # Ladder shaft up the middle of the tower
        top_wall = g - 1 - 4 * sh - (sh - 2)
        for y in range(top_wall, g):
            if grid[y][cx] in (Block.AIR, Block.PINK_GLASS):
                grid[y][cx] = Block.LADDER

    # ── Low wing with terraced roofs, attached on the left ───────────────────

    def _build_wing(self, grid, g, L) -> None:
        P, GL = Block.CHERRY_PLANKS, Block.PINK_GLASS
        wl, wr = L - 16, L - 1

        # Ground storey: pillars + glass, flat roof slab
        for y in range(g - 5, g):
            for x in range(wl, wr + 1):
                grid[y][x] = P if x in (wl, wl + 5, wl + 10, wr) else GL
        for x in range(wl - 3, wr + 1):
            grid[g - 6][x] = P                          # roof / terrace slab
        for x in range(wl - 3, wl + 4):
            grid[g - 7][x] = Block.CHERRY_FENCE         # terrace railing

        # Set-back second storey with its own flat roof
        for y in range(g - 10, g - 6):
            for x in range(wl + 5, wr + 1):
                grid[y][x] = P if x in (wl + 5, wl + 10, wr) else GL
        for x in range(wl + 4, wr + 1):
            grid[g - 11][x] = P

        # Doorway from the yard into the ground storey
        for y in (g - 1, g - 2):
            grid[y][wl + 8] = Block.AIR

    # ── Bridge over the river, with fence railing ────────────────────────────

    def _build_bridge(self, grid, g, R, river_r) -> None:
        for x in range(R + 1, river_r + 5):
            grid[g - 1][x] = Block.CHERRY_PLANKS
            grid[g - 2][x] = Block.CHERRY_FENCE

    # ── Cherry tree ──────────────────────────────────────────────────────────

    def _place_cherry_tree(self, grid, x, base_y, width, height, rng) -> None:
        trunk = rng.randint(4, 6)
        for ty in range(trunk):
            gy = base_y - ty
            if 0 <= gy < height:
                grid[gy][x] = Block.CHERRY_LOG
        top = base_y - trunk
        for ly in range(top - 2, top + 2):
            for lx in range(x - 3, x + 4):
                if 0 <= ly < height and 0 <= lx < width:
                    if grid[ly][lx] == Block.AIR and abs(lx - x) + abs(ly - top) <= 4:
                        grid[ly][lx] = Block.CHERRY_LEAVES

    def get_spawn(self, grid, width, height):
        # On the bridge, just outside the tower's front door
        return (width // 2 + self.TOWER_HALF + 3, SEA_LEVEL - 3)
