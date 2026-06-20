"""Reusable UI widgets and a small font cache."""

import pygame

from config import WHITE, UI_BORDER

_FONTS = {}


def font(size: int, bold: bool = True) -> pygame.font.Font:
    key = (size, bold)
    if key not in _FONTS:
        _FONTS[key] = pygame.font.SysFont("consolas,menlo,monospace", size, bold=bold)
    return _FONTS[key]


def text(screen, s, size, color, center=None, topleft=None, bold=True):
    surf = font(size, bold).render(s, True, color)
    rect = surf.get_rect()
    if center:
        rect.center = center
    elif topleft:
        rect.topleft = topleft
    screen.blit(surf, rect)
    return rect


class Button:
    def __init__(self, rect, label, color=(60, 60, 90),
                 hover=(95, 95, 140), text_color=WHITE, size=22):
        self.rect = pygame.Rect(rect)
        self.label = label
        self.color = color
        self.hover = hover
        self.text_color = text_color
        self.size = size

    def draw(self, screen):
        hovered = self.rect.collidepoint(pygame.mouse.get_pos())
        pygame.draw.rect(screen, self.hover if hovered else self.color,
                         self.rect, border_radius=8)
        pygame.draw.rect(screen, UI_BORDER, self.rect, 2, border_radius=8)
        label = font(self.size).render(self.label, True, self.text_color)
        screen.blit(label, label.get_rect(center=self.rect.center))

    def clicked(self, event) -> bool:
        return (event.type == pygame.MOUSEBUTTONDOWN and event.button == 1
                and self.rect.collidepoint(event.pos))
