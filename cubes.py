"""Cube customization: color palettes, icon shapes, and the renderer.

A cube is drawn from three pieces:
  * an outer body in the *primary* color (shape decided by the icon)
  * an inner detail in the *secondary* color
  * a thin dark outline so it reads against any background
"""

import pygame
from typing import List, Tuple

Color = Tuple[int, int, int]

# A friendly 12-swatch palette the player can mix primary/secondary from.
PALETTE: List[Color] = [
    (90,  200, 255),   # 0  cyan
    (70,  120, 255),   # 1  blue
    (150, 90,  255),   # 2  purple
    (255, 90,  200),   # 3  pink
    (255, 80,  90 ),   # 4  red
    (255, 150, 60 ),   # 5  orange
    (245, 210, 70 ),   # 6  yellow
    (255, 255, 255),   # 7  white
    (70,  220, 120),   # 8  green
    (40,  200, 200),   # 9  teal
    (150, 160, 175),   # 10 silver
    (30,  30,  40 ),   # 11 black
]

# Each icon is a named drawing style. Keep the list and the dispatch in
# `_draw_icon` in sync.
ICONS: List[str] = [
    "Classic",
    "Corner",
    "Circle",
    "Diamond",
    "Frame",
    "Stripes",
    "Triangle",
    "Grid",
]


def palette_color(index: int) -> Color:
    return PALETTE[index % len(PALETTE)]


def draw_cube(surface: pygame.Surface, rect: pygame.Rect,
              icon: int, primary: int, secondary: int) -> None:
    """Render a cube of the given style onto `surface` at `rect`."""
    p = palette_color(primary)
    s = palette_color(secondary)
    name = ICONS[icon % len(ICONS)]
    _draw_icon(surface, rect, name, p, s)
    pygame.draw.rect(surface, (15, 15, 22), rect, max(2, rect.width // 16),
                     border_radius=max(3, rect.width // 10))


def _draw_icon(surface, rect, name, p, s) -> None:
    x, y, w, h = rect
    radius = max(3, w // 10)

    if name == "Classic":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        inner = rect.inflate(-w // 2, -h // 2)
        pygame.draw.rect(surface, s, inner, border_radius=radius // 2)

    elif name == "Corner":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        tri = [(x, y), (x + w * 0.6, y), (x, y + h * 0.6)]
        pygame.draw.polygon(surface, s, tri)

    elif name == "Circle":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        pygame.draw.circle(surface, s, rect.center, w // 4)

    elif name == "Diamond":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        cx, cy = rect.center
        d = w // 3
        pygame.draw.polygon(surface, s,
                            [(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy)])

    elif name == "Frame":
        pygame.draw.rect(surface, s, rect, border_radius=radius)
        pygame.draw.rect(surface, p, rect, width=max(3, w // 6),
                         border_radius=radius)

    elif name == "Stripes":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        band = h // 5
        for i in range(1, 5, 2):
            pygame.draw.rect(surface, s, (x, y + i * band, w, band))

    elif name == "Triangle":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        cx = x + w // 2
        pygame.draw.polygon(surface, s,
                            [(cx, y + h * 0.22),
                             (x + w * 0.78, y + h * 0.78),
                             (x + w * 0.22, y + h * 0.78)])

    elif name == "Grid":
        pygame.draw.rect(surface, p, rect, border_radius=radius)
        pygame.draw.line(surface, s, (x + w // 2, y), (x + w // 2, y + h), 3)
        pygame.draw.line(surface, s, (x, y + h // 2), (x + w, y + h // 2), 3)

    else:  # fallback
        pygame.draw.rect(surface, p, rect, border_radius=radius)
