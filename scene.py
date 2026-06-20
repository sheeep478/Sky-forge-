"""Draws the playfield: themed background, scrolling ground, and obstacles."""

import pygame

from config import WIDTH, HEIGHT, GROUND_Y, TILE, GOLD

# The vertical gradient is identical every frame for a given theme, so render it
# once and cache the surface. This matters a lot on mobile/WASM where a per-frame
# pixel loop would tank the frame rate.
_bg_cache = {}


def _gradient_surface(theme):
    surf = _bg_cache.get(theme)
    if surf is not None:
        return surf
    top, bot = theme
    surf = pygame.Surface((WIDTH, HEIGHT)).convert()
    for y in range(0, HEIGHT, 2):
        t = y / HEIGHT
        c = (int(top[0] + (bot[0] - top[0]) * t),
             int(top[1] + (bot[1] - top[1]) * t),
             int(top[2] + (bot[2] - top[2]) * t))
        pygame.draw.rect(surf, c, (0, y, WIDTH, 2))
    _bg_cache[theme] = surf
    return surf


def draw_background(screen: pygame.Surface, theme, scroll: float) -> None:
    top, _ = theme
    screen.blit(_gradient_surface(theme), (0, 0))

    # Parallax diamonds drifting in the background.
    spacing = 220
    off = int(scroll * 0.3) % spacing
    shade = (min(255, top[0] + 25), min(255, top[1] + 25), min(255, top[2] + 25))
    for gx in range(-spacing, WIDTH + spacing, spacing):
        for gy in range(120, GROUND_Y - 40, 180):
            cx = gx - off + 110
            d = 16
            pts = [(cx, gy - d), (cx + d, gy), (cx, gy + d), (cx - d, gy)]
            pygame.draw.polygon(screen, shade, pts, 2)


def draw_ground(screen: pygame.Surface, ground_color, scroll: float) -> None:
    pygame.draw.rect(screen, ground_color, (0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y))
    # Bright top edge line.
    edge = tuple(min(255, c + 70) for c in ground_color)
    pygame.draw.rect(screen, edge, (0, GROUND_Y, WIDTH, 4))
    # Moving tile seams for a sense of speed.
    off = int(scroll) % TILE
    seam = tuple(min(255, c + 30) for c in ground_color)
    for x in range(-off, WIDTH, TILE):
        pygame.draw.line(screen, seam, (x, GROUND_Y + 4), (x, HEIGHT), 1)


def draw_obstacles(screen, level, camera, accent) -> None:
    left = camera.x - TILE
    right = camera.x + WIDTH + TILE
    for ob in level.obstacles:
        if ob.x + ob.w < left or ob.x > right:
            continue
        sx = camera.world_to_screen(ob.x)

        if ob.kind == "spike":
            pts = [(sx, ob.y + ob.h), (sx + ob.w / 2, ob.y), (sx + ob.w, ob.y + ob.h)]
            pygame.draw.polygon(screen, accent, pts)
            pygame.draw.polygon(screen, (15, 15, 22), pts, 2)

        elif ob.kind == "block":
            rect = pygame.Rect(int(sx), int(ob.y), int(ob.w), int(ob.h))
            pygame.draw.rect(screen, accent, rect)
            pygame.draw.rect(screen, (15, 15, 22), rect, 3)
            top = tuple(min(255, c + 50) for c in accent)
            pygame.draw.rect(screen, top, (int(sx), int(ob.y), int(ob.w), 5))

        elif ob.kind == "pad":
            rect = pygame.Rect(int(sx), int(ob.y), int(ob.w), int(ob.h))
            pygame.draw.rect(screen, GOLD, rect, border_radius=4)
            pygame.draw.rect(screen, (120, 90, 20), rect, 2, border_radius=4)


def draw_finish(screen, level, camera) -> None:
    sx = camera.world_to_screen(level.length_px - TILE * 2)
    if -TILE < sx < WIDTH + TILE:
        for i in range(0, GROUND_Y, 20):
            c = (240, 240, 240) if (i // 20) % 2 == 0 else (40, 40, 40)
            pygame.draw.rect(screen, c, (int(sx), i, 14, 20))
