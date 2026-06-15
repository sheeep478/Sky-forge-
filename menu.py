"""Main menu — title screen, template picker, and game-mode picker."""

import pygame
import random
from typing import Optional, Tuple

from config import WIDTH, HEIGHT, WHITE, BLACK, DARK_GRAY, GRAY, UI_BORDER
from templates.regular   import RegularTemplate
from templates.flat      import FlatTemplate
from templates.amplified import AmplifiedTemplate
from templates.skyblock  import SkyblockTemplate

# Registry — add new templates here
TEMPLATES = [
    RegularTemplate(),
    FlatTemplate(),
    AmplifiedTemplate(),
    SkyblockTemplate(),
]

GAME_MODES = ["survival", "creative"]


# ── Tiny UI helpers ───────────────────────────────────────────────────────────

class Button:
    def __init__(self, rect: pygame.Rect, text: str,
                 color=(70, 70, 70), hover=(100, 100, 100),
                 text_color=WHITE, font_size=22):
        self.rect        = rect
        self.text        = text
        self.color       = color
        self.hover_color = hover
        self.text_color  = text_color
        self._font       = pygame.font.SysFont("monospace", font_size, bold=True)

    def draw(self, screen: pygame.Surface) -> None:
        hovered = self.rect.collidepoint(pygame.mouse.get_pos())
        bg      = self.hover_color if hovered else self.color
        pygame.draw.rect(screen, bg,       self.rect, border_radius=6)
        pygame.draw.rect(screen, UI_BORDER, self.rect, 2, border_radius=6)
        label = self._font.render(self.text, True, self.text_color)
        lx    = self.rect.centerx - label.get_width()  // 2
        ly    = self.rect.centery - label.get_height() // 2
        screen.blit(label, (lx, ly))

    def is_clicked(self, event: pygame.event.Event) -> bool:
        return (event.type == pygame.MOUSEBUTTONDOWN
                and event.button == 1
                and self.rect.collidepoint(event.pos))


# ── Menu state machine ────────────────────────────────────────────────────────

class Menu:
    """
    States
    ------
    "title"      — main title screen
    "play"       — template + mode selector
    "done"       — user confirmed; read .chosen_template / .chosen_mode / .seed
    """

    def __init__(self):
        pygame.font.init()
        self.state: str = "title"

        self.chosen_template = TEMPLATES[0]
        self.chosen_mode     = "survival"
        self.seed            = random.randint(0, 99999)

        self._font_title = pygame.font.SysFont("monospace", 58, bold=True)
        self._font_sub   = pygame.font.SysFont("monospace", 20)
        self._font_label = pygame.font.SysFont("monospace", 16, bold=True)

        self._build_title_buttons()
        self._build_play_buttons()

    # ── Build buttons ─────────────────────────────────────────────────────────

    def _build_title_buttons(self) -> None:
        cx = WIDTH // 2
        self._btn_play = Button(pygame.Rect(cx - 130, 340, 260, 52), "Play")
        self._btn_quit = Button(pygame.Rect(cx - 130, 410, 260, 52), "Quit",
                                color=(120, 40, 40), hover=(160, 60, 60))

    def _build_play_buttons(self) -> None:
        cx = WIDTH // 2

        # Template buttons
        self._tmpl_btns = []
        total_w = len(TEMPLATES) * 180 + (len(TEMPLATES) - 1) * 12
        start_x = cx - total_w // 2
        for i, tmpl in enumerate(TEMPLATES):
            r = pygame.Rect(start_x + i * 192, 230, 180, 52)
            self._tmpl_btns.append(Button(r, tmpl.name))

        # Mode buttons
        self._mode_btns = []
        for i, mode in enumerate(GAME_MODES):
            r = pygame.Rect(cx - 210 + i * 220, 330, 200, 52)
            self._mode_btns.append(Button(r, mode.title()))

        # Seed
        self._btn_reseed = Button(pygame.Rect(cx - 90, 420, 180, 44),
                                  "New Seed",
                                  color=(50, 80, 120), hover=(70, 110, 160))

        # Start
        self._btn_start = Button(
            pygame.Rect(cx - 130, 500, 260, 56),
            "Start Game",
            color=(40, 120, 40), hover=(60, 160, 60), font_size=24)

        # Back
        self._btn_back = Button(pygame.Rect(cx - 90, 580, 180, 40),
                                "← Back",
                                color=(80, 50, 50), hover=(120, 70, 70),
                                font_size=18)

    # ── Event handling ────────────────────────────────────────────────────────

    def handle_event(self, event: pygame.event.Event) -> None:
        if self.state == "title":
            if self._btn_play.is_clicked(event):
                self.state = "play"
            if self._btn_quit.is_clicked(event):
                pygame.quit()
                raise SystemExit

        elif self.state == "play":
            for i, btn in enumerate(self._tmpl_btns):
                if btn.is_clicked(event):
                    self.chosen_template = TEMPLATES[i]

            for i, btn in enumerate(self._mode_btns):
                if btn.is_clicked(event):
                    self.chosen_mode = GAME_MODES[i]

            if self._btn_reseed.is_clicked(event):
                self.seed = random.randint(0, 99999)

            if self._btn_start.is_clicked(event):
                self.state = "done"

            if self._btn_back.is_clicked(event):
                self.state = "title"

    # ── Drawing ───────────────────────────────────────────────────────────────

    def draw(self, screen: pygame.Surface) -> None:
        if self.state == "title":
            self._draw_title(screen)
        elif self.state == "play":
            self._draw_play(screen)

    def _draw_title(self, screen: pygame.Surface) -> None:
        screen.fill((20, 20, 40))
        self._draw_stars(screen)

        # Gradient sky strip
        for y in range(200):
            c = int(20 + y * 0.6)
            pygame.draw.line(screen, (c, c + 30, c + 80), (0, y), (WIDTH, y))

        title = self._font_title.render("PyMine", True, WHITE)
        shadow = self._font_title.render("PyMine", True, (60, 60, 60))
        tx = WIDTH // 2 - title.get_width() // 2
        screen.blit(shadow, (tx + 3, 153))
        screen.blit(title,  (tx,     150))

        sub = self._font_sub.render("A Minecraft-inspired 2D survival game", True, (180, 180, 180))
        screen.blit(sub, (WIDTH // 2 - sub.get_width() // 2, 224))

        self._btn_play.draw(screen)
        self._btn_quit.draw(screen)

        hint = self._font_label.render("WASD / Arrows: move  |  Space: jump  |  LMB: mine  |  RMB: place", True, GRAY)
        screen.blit(hint, (WIDTH // 2 - hint.get_width() // 2, HEIGHT - 30))

    def _draw_play(self, screen: pygame.Surface) -> None:
        screen.fill((25, 25, 45))

        head = self._font_title.render("New World", True, WHITE)
        screen.blit(head, (WIDTH // 2 - head.get_width() // 2, 130))

        # Section labels
        def label(text, y):
            s = self._font_label.render(text, True, (180, 180, 200))
            screen.blit(s, (WIDTH // 2 - s.get_width() // 2, y))

        label("── World Type ──", 195)
        label("── Game Mode ──",  295)
        label("── Seed ──",       390)

        # Template buttons (highlight selected)
        for i, btn in enumerate(self._tmpl_btns):
            if TEMPLATES[i] is self.chosen_template:
                btn.color       = (40, 110, 40)
                btn.hover_color = (60, 150, 60)
            else:
                btn.color       = (70, 70, 70)
                btn.hover_color = (100, 100, 100)
            btn.draw(screen)

        # Mode buttons
        for i, btn in enumerate(self._mode_btns):
            if GAME_MODES[i] == self.chosen_mode:
                btn.color       = (40, 80, 140)
                btn.hover_color = (60, 110, 180)
            else:
                btn.color       = (70, 70, 70)
                btn.hover_color = (100, 100, 100)
            btn.draw(screen)

        # Seed display
        seed_txt = self._font_sub.render(f"Seed: {self.seed}", True, WHITE)
        screen.blit(seed_txt, (WIDTH // 2 - seed_txt.get_width() // 2, 428))
        self._btn_reseed.draw(screen)

        # Description
        desc = self._font_label.render(self.chosen_template.description,
                                       True, (160, 160, 180))
        screen.blit(desc, (WIDTH // 2 - desc.get_width() // 2, 472))

        self._btn_start.draw(screen)
        self._btn_back.draw(screen)

    def _draw_stars(self, screen: pygame.Surface) -> None:
        import math
        for i in range(80):
            sx = (i * 173 + 37) % WIDTH
            sy = (i * 97  + 13) % (HEIGHT // 2)
            r  = 1 + (i % 2)
            pygame.draw.circle(screen, WHITE, (sx, sy), r)
