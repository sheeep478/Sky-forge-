"""Skyscraper world — a flat city block with a tall glass-and-stone tower."""

from typing import List

from blocks import Block
from config import SEA_LEVEL
from templates import WorldTemplate


class SkyscraperTemplate(WorldTemplate):
    name        = "Skyscraper"
    description = "A towering glass-and-stone skyscraper on a flat city block."

    # ── Tower dimensions (blocks) ────────────────────────────────────────────
    TOWER_WIDTH   = 25    # odd, so it centers cleanly
    LOBBY_HEIGHT  = 6     # double-height ground floor
    FLOOR_HEIGHT  = 5     # slab + 4 blocks of window wall
    NUM_FLOORS    = 12    # floors above the lobby
    SETBACK       = 4     # blocks trimmed off each side for the top section
    TOP_FLOORS    = 3     # floors in the narrower top section
    SPIRE_HEIGHT  = 8

    def generate(self, width: int, height: int, seed: int) -> List[List[int]]:
        grid    = [[Block.AIR] * width for _ in range(height)]
        surface = SEA_LEVEL

        # Flat ground: grass / dirt / stone / bedrock
        for x in range(width):
            grid[surface][x] = Block.GRASS
            for y in range(surface + 1, surface + 4):
                grid[y][x] = Block.DIRT
            for y in range(surface + 4, height - 1):
                grid[y][x] = Block.STONE
            grid[height - 1][x] = Block.BEDROCK

        self._build_tower(grid, width, height, surface)
        return grid

    # ── Tower construction ───────────────────────────────────────────────────

    def _build_tower(self, grid, width, height, surface) -> None:
        cx    = width // 2
        half  = self.TOWER_WIDTH // 2
        left  = cx - half
        right = cx + half

        y = surface  # ground row (grass); the tower sits on top of it

        # Lobby: stone frame, glass front, tall doorway in the middle
        lobby_top = y - self.LOBBY_HEIGHT
        self._build_section(grid, left, right, y - 1, lobby_top,
                            pillar_every=6)
        # Entrance: carve a 3-wide, 4-tall doorway through the lobby wall
        for dy in range(1, 5):
            for dx in range(cx - 1, cx + 2):
                grid[y - dy][dx] = Block.AIR
        # Doorway frame in planks
        for dy in range(1, 6):
            grid[y - dy][cx - 2] = Block.OAK_PLANKS
            grid[y - dy][cx + 2] = Block.OAK_PLANKS
        for dx in range(cx - 2, cx + 3):
            grid[y - 5][dx] = Block.OAK_PLANKS

        # Main shaft: repeated window floors
        y = lobby_top
        for _ in range(self.NUM_FLOORS):
            floor_top = y - self.FLOOR_HEIGHT
            self._build_section(grid, left, right, y - 1, floor_top,
                                pillar_every=4)
            y = floor_top

        # Setback ledge, then the narrower top section
        for x in range(left, right + 1):
            grid[y - 1][x] = Block.COBBLESTONE
        top_left  = left  + self.SETBACK
        top_right = right - self.SETBACK
        y -= 1
        for _ in range(self.TOP_FLOORS):
            floor_top = y - self.FLOOR_HEIGHT
            self._build_section(grid, top_left, top_right, y - 1, floor_top,
                                pillar_every=4)
            y = floor_top

        # Roof slab and spire
        for x in range(top_left, top_right + 1):
            grid[y - 1][x] = Block.COBBLESTONE
        spire_x = (top_left + top_right) // 2
        for dy in range(self.SPIRE_HEIGHT):
            gy = y - 2 - dy
            if gy >= 0:
                grid[gy][spire_x] = Block.OAK_LOG

    def _build_section(self, grid, left, right, bottom, top,
                       pillar_every: int) -> None:
        """One vertical section: floor slab at `bottom`, walls up to `top`.

        Outer columns and every `pillar_every`-th column are stone pillars;
        everything between is a glass curtain wall.
        """
        for x in range(left, right + 1):
            grid[bottom][x] = Block.STONE          # floor slab
        for y in range(top, bottom):
            for x in range(left, right + 1):
                on_pillar = (x == left or x == right
                             or (x - left) % pillar_every == 0)
                grid[y][x] = Block.STONE if on_pillar else Block.GLASS

    def get_spawn(self, grid, width, height):
        # Spawn just outside the entrance, to the left of the tower
        cx = width // 2
        return (cx - self.TOWER_WIDTH // 2 - 4, SEA_LEVEL - 2)
