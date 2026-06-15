"""Flat world — perfectly level surface with bedrock floor."""

from typing import List

from blocks import Block
from config import SEA_LEVEL
from templates import WorldTemplate


class FlatTemplate(WorldTemplate):
    name        = "Flat"
    description = "A perfectly flat world — great for building."

    # Layer layout from surface downward:  grass / 3×dirt / stone / bedrock
    LAYERS = [
        (1, Block.GRASS),
        (3, Block.DIRT),
        (0, Block.STONE),   # 0 = fill to near-bottom
        (1, Block.BEDROCK),
    ]

    def generate(self, width: int, height: int, seed: int) -> List[List[int]]:
        grid    = [[Block.AIR] * width for _ in range(height)]
        surface = SEA_LEVEL

        # Build column prototype
        column = [Block.AIR] * height
        y = surface
        for count, block in self.LAYERS:
            if count == 0:
                # fill until bedrock row
                while y < height - 1:
                    column[y] = block
                    y += 1
            else:
                for _ in range(count):
                    if y < height:
                        column[y] = block
                        y += 1
        column[height - 1] = Block.BEDROCK

        for x in range(width):
            for row, b in enumerate(column):
                grid[row][x] = b

        return grid

    def get_spawn(self, grid, width, height):
        return (width // 2, SEA_LEVEL - 2)
