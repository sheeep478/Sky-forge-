"""
World generation templates.

To add a new template:
  1. Create templates/mytemplate.py with a class that subclasses WorldTemplate.
  2. Implement generate(width, height, seed) → List[List[int]]  (grid[y][x])
  3. Optionally override get_spawn(grid, width, height) → (x, y) in block coords.
  4. Add it to TEMPLATES in menu.py.
"""

from __future__ import annotations
from typing import List, Tuple


class WorldTemplate:
    name: str        = "Unknown"
    description: str = ""

    def generate(self, width: int, height: int, seed: int) -> List[List[int]]:
        """Return 2-D block grid.  grid[y][x]; y=0 is the topmost row."""
        raise NotImplementedError

    def get_spawn(self, grid: List[List[int]], width: int, height: int) -> Tuple[int, int]:
        """Return (block_x, block_y) where the player should spawn."""
        cx = width // 2
        for y in range(height):
            if grid[y][cx] != 0:          # 0 = AIR
                return (cx, y - 2)
        return (cx, height // 2)
