"""HUD — hotbar, health, hunger, crosshair, and block tooltip."""

import pygame
from typing import Optional

from blocks import Block, BLOCK_COLORS, BLOCK_NAMES, ORE_DOTS
from config import (WIDTH, HEIGHT, BLOCK_SIZE, HOTBAR_SLOTS,
                    MAX_HEALTH, MAX_HUNGER,
                    WHITE, BLACK, DARK_GRAY, GRAY,
                    UI_BG, UI_BORDER, HEALTH_RED, HUNGER_GOLD)

SLOT_SIZE    = 44
SLOT_PADDING = 4
HOTBAR_W     = HOTBAR_SLOTS * (SLOT_SIZE + SLOT_PADDING) - SLOT_PADDING
HOTBAR_X     = (WIDTH  - HOTBAR_W) // 2
HOTBAR_Y     = HEIGHT - SLOT_SIZE - 8


def _draw_block_icon(surface: pygame.Surface, rect: pygame.Rect, block: int) -> None:
    """Draw a tiny block icon into rect."""
    colors = BLOCK_COLORS.get(block)
    if colors is None or colors[0] is None:
        return

    top_c, side_c = colors
    r = rect.inflate(-6, -6)

    if block == Block.GRASS and side_c:
        pygame.draw.rect(surface, side_c, r)
        pygame.draw.rect(surface, top_c, (r.x, r.y, r.w, max(1, r.h // 5)))
    elif block == Block.WATER:
        pygame.draw.rect(surface, (40, 80, 200), r)
    else:
        pygame.draw.rect(surface, top_c, r)

    if block in ORE_DOTS:
        dc = ORE_DOTS[block]
        for ddx, ddy in [(3, 3), (9, 3), (3, 9), (9, 9)]:
            pygame.draw.rect(surface, dc, (r.x + ddx, r.y + ddy, 3, 3))

    pygame.draw.rect(surface, (0, 0, 0), r, 1)


def _draw_hearts(screen: pygame.Surface, health: int, font: pygame.font.Font) -> None:
    x, y = 10, HEIGHT - SLOT_SIZE - 50
    full  = health // 2
    half  = health %  2
    empty = MAX_HEALTH // 2 - full - half
    for _ in range(full):
        pygame.draw.rect(screen, HEALTH_RED, (x, y, 14, 14))
        pygame.draw.rect(screen, BLACK,      (x, y, 14, 14), 1)
        x += 16
    if half:
        pygame.draw.rect(screen, HEALTH_RED,   (x, y, 7, 14))
        pygame.draw.rect(screen, (80, 80, 80), (x + 7, y, 7, 14))
        pygame.draw.rect(screen, BLACK,         (x, y, 14, 14), 1)
        x += 16
    for _ in range(empty):
        pygame.draw.rect(screen, (80, 80, 80), (x, y, 14, 14))
        pygame.draw.rect(screen, BLACK,         (x, y, 14, 14), 1)
        x += 16


def _draw_hunger(screen: pygame.Surface, hunger: int) -> None:
    x = WIDTH - 10 - 10 * 16
    y = HEIGHT - SLOT_SIZE - 50
    full  = hunger // 2
    half  = hunger %  2
    empty = MAX_HUNGER // 2 - full - half
    for _ in range(full):
        pygame.draw.rect(screen, HUNGER_GOLD, (x, y, 14, 14))
        pygame.draw.rect(screen, BLACK,       (x, y, 14, 14), 1)
        x += 16
    if half:
        pygame.draw.rect(screen, HUNGER_GOLD,  (x, y, 7, 14))
        pygame.draw.rect(screen, (80, 80, 80), (x + 7, y, 7, 14))
        pygame.draw.rect(screen, BLACK,        (x, y, 14, 14), 1)
        x += 16
    for _ in range(empty):
        pygame.draw.rect(screen, (80, 80, 80), (x, y, 14, 14))
        pygame.draw.rect(screen, BLACK,        (x, y, 14, 14), 1)
        x += 16


class HUD:
    def __init__(self):
        pygame.font.init()
        self.font_sm = pygame.font.SysFont("monospace", 14, bold=True)
        self.font_md = pygame.font.SysFont("monospace", 18, bold=True)

    def draw(self, screen: pygame.Surface, player, hovered_block: Optional[int]) -> None:
        self._draw_hotbar(screen, player)
        if player.mode == "survival":
            _draw_hearts(screen, player.health, self.font_sm)
            _draw_hunger(screen, player.hunger)
        self._draw_crosshair(screen)
        self._draw_mode_badge(screen, player)
        if hovered_block is not None and hovered_block != Block.AIR:
            self._draw_tooltip(screen, hovered_block)

    def _draw_hotbar(self, screen: pygame.Surface, player) -> None:
        for i in range(HOTBAR_SLOTS):
            x = HOTBAR_X + i * (SLOT_SIZE + SLOT_PADDING)
            rect = pygame.Rect(x, HOTBAR_Y, SLOT_SIZE, SLOT_SIZE)

            # Background
            bg = (60, 60, 60) if i != player.selected else (180, 130, 40)
            pygame.draw.rect(screen, bg, rect)
            pygame.draw.rect(screen, UI_BORDER, rect, 2)

            block = player.hotbar[i]
            if block != Block.AIR and (player.mode == "creative"
                                       or player.counts[i] > 0):
                _draw_block_icon(screen, rect, block)

                # Count badge (survival only)
                if player.mode == "survival" and player.counts[i] > 0:
                    cnt   = str(player.counts[i])
                    label = self.font_sm.render(cnt, True, WHITE)
                    screen.blit(label, (rect.right - label.get_width() - 2,
                                        rect.bottom - label.get_height()))

            # Slot number
            num = self.font_sm.render(str(i + 1), True, GRAY)
            screen.blit(num, (rect.x + 2, rect.y + 2))

    def _draw_crosshair(self, screen: pygame.Surface) -> None:
        cx, cy = WIDTH // 2, HEIGHT // 2
        pygame.draw.line(screen, WHITE, (cx - 10, cy), (cx + 10, cy), 2)
        pygame.draw.line(screen, WHITE, (cx, cy - 10), (cx, cy + 10), 2)
        pygame.draw.line(screen, BLACK, (cx - 10, cy), (cx + 10, cy), 1)
        pygame.draw.line(screen, BLACK, (cx, cy - 10), (cx, cy + 10), 1)

    def _draw_mode_badge(self, screen: pygame.Surface, player) -> None:
        label = self.font_sm.render(player.mode.upper(), True, WHITE)
        bg    = pygame.Rect(WIDTH - label.get_width() - 10, 6,
                            label.get_width() + 8, label.get_height() + 4)
        pygame.draw.rect(screen, DARK_GRAY, bg, border_radius=4)
        screen.blit(label, (bg.x + 4, bg.y + 2))

        if player.flying:
            fly = self.font_sm.render("FLYING", True, (100, 200, 255))
            screen.blit(fly, (WIDTH - fly.get_width() - 10,
                               bg.bottom + 4))

    def _draw_tooltip(self, screen: pygame.Surface, block: int) -> None:
        name  = BLOCK_NAMES.get(block, "Unknown")
        label = self.font_md.render(name, True, WHITE)
        bg    = pygame.Rect(WIDTH // 2 - label.get_width() // 2 - 6,
                            HEIGHT // 2 + 24,
                            label.get_width() + 12,
                            label.get_height() + 6)
        s = pygame.Surface((bg.w, bg.h), pygame.SRCALPHA)
        s.fill((0, 0, 0, 160))
        screen.blit(s, bg.topleft)
        screen.blit(label, (bg.x + 6, bg.y + 3))
