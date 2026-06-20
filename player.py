"""The player cube: auto-run physics, collision, death, and rendering."""

import pygame
from typing import List, Tuple

import cubes
from config import (CUBE_SIZE, GROUND_Y, GRAVITY, JUMP_VELOCITY,
                    TERMINAL_VELOCITY, BASE_SPEED, ROT_SPEED)

LAND_TOL = 14            # how far below a surface still counts as "landing on top"
PAD_BOOST = -16.5        # jump-pad launch velocity


class Cube:
    def __init__(self, level, icon: int, primary: int, secondary: int):
        self.level = level
        self.icon = icon
        self.primary = primary
        self.secondary = secondary

        self.size = CUBE_SIZE
        self.x = 6.0 * CUBE_SIZE
        self.y = float(GROUND_Y - self.size)
        self.vy = 0.0
        self.speed = BASE_SPEED * level.speed_mult

        self.on_ground = True
        self.dead = False
        self.finished = False
        self.angle = 0.0

        self.trail: List[Tuple[float, float]] = []
        self._pre_surf = pygame.Surface((self.size, self.size), pygame.SRCALPHA)
        cubes.draw_cube(self._pre_surf,
                        pygame.Rect(0, 0, self.size, self.size),
                        icon, primary, secondary)

    # ── Geometry ────────────────────────────────────────────────────────────

    @property
    def rect(self) -> pygame.Rect:
        return pygame.Rect(int(self.x), int(self.y), self.size, self.size)

    @property
    def progress(self) -> float:
        return min(1.0, self.x / max(1.0, self.level.length_px - self.size))

    # ── Update ──────────────────────────────────────────────────────────────

    def update(self, jump_held: bool) -> None:
        if self.dead or self.finished:
            return

        prev_bottom = self.y + self.size

        # Horizontal auto-run.
        self.x += self.speed

        # Auto-jump while grounded and the button is held (classic GD feel).
        if jump_held and self.on_ground:
            self.vy = JUMP_VELOCITY
            self.on_ground = False

        # Gravity.
        self.vy = min(self.vy + GRAVITY, TERMINAL_VELOCITY)
        self.y += self.vy

        self.on_ground = False
        self._resolve(prev_bottom)

        # Spin while airborne; snap upright on landing.
        if self.on_ground:
            self.angle = 0.0
        else:
            self.angle = (self.angle - ROT_SPEED) % 360

        # Trail history.
        self.trail.append((self.x + self.size / 2, self.y + self.size / 2))
        if len(self.trail) > 18:
            self.trail.pop(0)

        if self.progress >= 1.0:
            self.finished = True

    def _resolve(self, prev_bottom: float) -> None:
        crect = self.rect

        for ob in self.level.obstacles:        # obstacles are sorted by x
            if ob.x > self.x + self.size:          # past the cube; none further collide
                break
            if ob.x + ob.w < self.x:               # already cleared
                continue
            br = ob.rect()
            if not crect.colliderect(br):
                continue

            if ob.kind == "spike":
                hit = br.inflate(-16, -14)
                hit.bottom = br.bottom
                if crect.colliderect(hit):
                    self.dead = True
                    return

            elif ob.kind == "pad":
                self.vy = PAD_BOOST
                self.on_ground = False

            elif ob.kind == "block":
                if prev_bottom <= br.top + LAND_TOL and self.vy >= 0:
                    self.y = br.top - self.size
                    self.vy = 0.0
                    self.on_ground = True
                    crect = self.rect
                else:
                    self.dead = True
                    return

        # Floor.
        if self.y + self.size >= GROUND_Y:
            self.y = GROUND_Y - self.size
            self.vy = 0.0
            self.on_ground = True

    # ── Render ──────────────────────────────────────────────────────────────

    def draw(self, screen: pygame.Surface, camera, show_trail: bool) -> None:
        if show_trail:
            for i, (tx, ty) in enumerate(self.trail):
                sx = camera.world_to_screen(tx)
                alpha = int(110 * (i / len(self.trail)))
                r = int(self.size * 0.4 * (i / len(self.trail)))
                if r <= 0:
                    continue
                surf = pygame.Surface((r * 2, r * 2), pygame.SRCALPHA)
                col = cubes.palette_color(self.primary)
                pygame.draw.circle(surf, (*col, alpha), (r, r), r)
                screen.blit(surf, (sx - r, ty - r))

        sx = camera.world_to_screen(self.x)
        if abs(self.angle) < 0.5:
            screen.blit(self._pre_surf, (int(sx), int(self.y)))
        else:
            rot = pygame.transform.rotate(self._pre_surf, self.angle)
            rect = rot.get_rect(center=(int(sx + self.size / 2),
                                        int(self.y + self.size / 2)))
            screen.blit(rot, rect.topleft)
