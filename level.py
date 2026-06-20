"""Level model + a deterministic, self-validating obstacle generator.

A level is an auto-scrolling obstacle course. The generator emits patterns and
then proves the result is clearable with `solver.beatable`, retrying seeds until
it finds a fair layout (with a guaranteed-clearable fallback). Every level the
game ships is therefore beatable.

Obstacle kinds
--------------
  "spike"     a ground triangle — touching its (forgiving) hitbox is death
  "block"     a solid raised platform — land on top, but hitting its side kills
  "pad"       a yellow jump pad — bounces the cube extra high on contact
"""

import random
from typing import Dict, List, Tuple

from config import TILE, GROUND_Y


class Obstacle:
    __slots__ = ("kind", "x", "y", "w", "h")

    def __init__(self, kind: str, x: float, y: float, w: float, h: float):
        self.kind = kind
        self.x = x
        self.y = y
        self.w = w
        self.h = h

    def rect(self):
        import pygame
        return pygame.Rect(int(self.x), int(self.y), int(self.w), int(self.h))


class Level:
    def __init__(self, index: int, song: Dict):
        self.index = index
        self.song = song
        self.speed_mult = song["speed"]
        self.difficulty = song["difficulty"]
        self.obstacles: List[Obstacle] = []
        self.length_px = 0.0
        self._build()

    # ── Build with validation ──────────────────────────────────────────────────

    def _build(self) -> None:
        import solver
        base = 1000 + self.index * 17
        for attempt in range(60):
            obs, length = self._layout(base + attempt * 131, safe=False)
            self.obstacles, self.length_px = obs, length
            if solver.beatable(self):
                return
        # Fallback: a conservative layout that is always clearable.
        self.obstacles, self.length_px = self._layout(base, safe=True)

    # ── Layout generation (pure: returns data, no validation) ──────────────────

    def _layout(self, seed: int, safe: bool) -> Tuple[List[Obstacle], float]:
        rng = random.Random(seed)
        diff = self.difficulty
        obs: List[Obstacle] = []

        length_tiles = 200 + diff * 30
        col = 14                                  # leading flat run-up

        if safe:
            max_spikes = 1
            gap_lo, gap_hi = 6, 9
        else:
            max_spikes = min(1 + diff // 2, 3)
            gap_lo = max(3, 7 - diff)
            gap_hi = max(gap_lo + 3, 11 - diff)

        while col < length_tiles - 12:
            roll = rng.random()

            if safe or roll < 0.50:
                n = rng.randint(1, max_spikes)
                for k in range(n):
                    obs.append(self._spike(col + k))
                col += n

            elif roll < 0.74:
                bw = rng.randint(2, 3)
                bh = rng.randint(1, min(2, diff))
                if rng.random() < 0.5 and diff >= 2:
                    obs.append(self._spike(col))
                    col += 2
                obs.append(self._block(col, bw, bh))
                col += bw

            elif roll < 0.90:
                obs.append(self._pad(col))
                obs.append(self._spike(col + 2))
                col += 3

            else:
                col += 2

            col += rng.randint(gap_lo, gap_hi)

        return obs, (length_tiles + 6) * TILE

    def _spike(self, col: int) -> Obstacle:
        return Obstacle("spike", col * TILE, GROUND_Y - TILE, TILE, TILE)

    def _block(self, col: int, w_tiles: int, h_tiles: int) -> Obstacle:
        h = h_tiles * TILE
        return Obstacle("block", col * TILE, GROUND_Y - h, w_tiles * TILE, h)

    def _pad(self, col: int) -> Obstacle:
        return Obstacle("pad", col * TILE, GROUND_Y - TILE // 4, TILE, TILE // 4)
