"""World — stores the block grid and handles drawing."""

import pygame
from typing import List

from blocks import Block, BLOCK_COLORS, ORE_DOTS, is_solid
from camera import Camera
from config import BLOCK_SIZE, SKY_COLOR
from templates import WorldTemplate


class World:
    def __init__(self, width: int, height: int):
        self.width:  int = width
        self.height: int = height
        self.grid:   List[List[int]] = [[Block.AIR] * width for _ in range(height)]
        self.spawn = (width // 2, height // 2)

    def generate(self, template: WorldTemplate, seed: int) -> None:
        self.grid  = template.generate(self.width, self.height, seed)
        self.spawn = template.get_spawn(self.grid, self.width, self.height)

    # ── Block access ─────────────────────────────────────────────────────────

    def get_block(self, bx: int, by: int) -> int:
        if 0 <= bx < self.width and 0 <= by < self.height:
            return self.grid[by][bx]
        return Block.BEDROCK

    def set_block(self, bx: int, by: int, block: int) -> None:
        if 0 <= bx < self.width and 0 <= by < self.height:
            self.grid[by][bx] = block

    def is_solid(self, bx: int, by: int) -> bool:
        return is_solid(self.get_block(bx, by))

    # ── Rendering ─────────────────────────────────────────────────────────────

    def draw(self, screen: pygame.Surface, camera: Camera) -> None:
        screen.fill(SKY_COLOR)

        bs = BLOCK_SIZE
        left   = max(0, int(camera.x // bs) - 1)
        right  = min(self.width,  int((camera.x + camera.view_w) // bs) + 2)
        top    = max(0, int(camera.y // bs) - 1)
        bottom = min(self.height, int((camera.y + camera.view_h) // bs) + 2)

        for by in range(top, bottom):
            for bx in range(left, right):
                block = self.grid[by][bx]
                if block == Block.AIR:
                    continue

                colors = BLOCK_COLORS.get(block)
                if colors is None or colors[0] is None:
                    continue

                top_c, side_c = colors
                sx = int(bx * bs - camera.x)
                sy = int(by * bs - camera.y)
                rect = pygame.Rect(sx, sy, bs, bs)

                if block == Block.WATER:
                    pygame.draw.rect(screen, (40, 80, 200), rect)
                    # Wavy line at top
                    pygame.draw.line(screen, (80, 130, 240),
                                     (sx, sy + 4), (sx + bs, sy + 4), 2)
                    pygame.draw.rect(screen, (20, 60, 180), rect, 1)
                    continue

                # Grass: green top strip, dirt sides
                if block == Block.GRASS and side_c:
                    pygame.draw.rect(screen, side_c, rect)
                    pygame.draw.rect(screen, top_c,
                                     (sx, sy, bs, max(1, bs // 5)))
                else:
                    pygame.draw.rect(screen, top_c, rect)

                # Ore dot decorations
                if block in ORE_DOTS:
                    dc = ORE_DOTS[block]
                    for ddx, ddy in [(6, 6), (18, 6), (6, 18), (18, 18)]:
                        pygame.draw.rect(screen, dc,
                                         (sx + ddx, sy + ddy, 6, 6))

                # Thin border
                pygame.draw.rect(screen, (0, 0, 0), rect, 1)
