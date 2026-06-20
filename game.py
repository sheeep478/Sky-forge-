"""Top-level state machine: title, level select, cube editor, and play."""

import pygame

import cubes
import save as save_mod
import scene
from camera import Camera
from config import (WIDTH, HEIGHT, GROUND_Y, TILE, WHITE, GRAY, LIGHT_GRAY,
                    ACCENT, GOOD, BAD, GOLD, UI_BG, UI_BORDER, DARK)
from level import Level
from menu import Button, text, font
from music import SONGS, MusicPlayer
from player import Cube


class Game:
    def __init__(self, screen: pygame.Surface):
        self.screen = screen
        self.state = "title"
        self.data = save_mod.load()
        self.music = MusicPlayer()
        self.music.pregenerate()

        self.camera = Camera()
        self.level = None
        self.cube = None
        self.attempts = 0
        self.bg_scroll = 0.0
        self._title_cube_y = 0.0
        self._title_cube_vy = 0.0

        self._build_title()
        self._build_select()
        self._build_customize()

    # ── Builders ──────────────────────────────────────────────────────────────

    def _build_title(self):
        cx = WIDTH // 2
        self.btn_play   = Button((cx - 130, 360, 260, 56), "Play",
                                 color=(40, 130, 70), hover=(60, 170, 95), size=26)
        self.btn_custom = Button((cx - 130, 430, 260, 52), "Customize Cube")
        self.btn_quit   = Button((cx - 130, 496, 260, 48), "Quit",
                                 color=(120, 45, 55), hover=(160, 65, 75))

    def _build_select(self):
        self.level_cards = []
        cols, cw, ch, gap = 4, 270, 150, 24
        total_w = cols * cw + (cols - 1) * gap
        start_x = (WIDTH - total_w) // 2
        start_y = 190
        for i in range(len(SONGS)):
            r = i // cols
            c = i % cols
            rect = pygame.Rect(start_x + c * (cw + gap),
                               start_y + r * (ch + gap), cw, ch)
            self.level_cards.append(rect)
        self.btn_select_back = Button((40, HEIGHT - 70, 160, 46), "< Back")

    def _build_customize(self):
        self.btn_cust_back = Button((40, HEIGHT - 70, 160, 46), "< Back")
        self.btn_icon_prev = Button((250, 250, 56, 56), "<", size=28)
        self.btn_icon_next = Button((470, 250, 56, 56), ">", size=28)
        self.btn_trail = Button((250, 560, 276, 48), "Trail: On")
        # Palette swatch rects (built once; reused for primary & secondary rows).
        self.swatch = TILE  # reuse size constant
        self.prim_rects = self._swatch_row(720, 300)
        self.sec_rects  = self._swatch_row(720, 480)

    def _swatch_row(self, x0, y0):
        rects = []
        per_row = 6
        s, gap = 56, 12
        for i in range(len(cubes.PALETTE)):
            r = i // per_row
            c = i % per_row
            rects.append(pygame.Rect(x0 + c * (s + gap), y0 + r * (s + gap), s, s))
        return rects

    # ── Event handling ──────────────────────────────────────────────────────

    def handle_event(self, event):
        if self.state == "title":
            self._title_events(event)
        elif self.state == "select":
            self._select_events(event)
        elif self.state == "customize":
            self._customize_events(event)
        elif self.state == "play":
            self._play_events(event)
        elif self.state in ("dead", "complete"):
            self._overlay_events(event)

    def _title_events(self, event):
        if self.btn_play.clicked(event):
            self.state = "select"
        elif self.btn_custom.clicked(event):
            self.state = "customize"
        elif self.btn_quit.clicked(event):
            pygame.quit(); raise SystemExit

    def _select_events(self, event):
        if self.btn_select_back.clicked(event):
            self.state = "title"
            return
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            for i, rect in enumerate(self.level_cards):
                if rect.collidepoint(event.pos):
                    self._start_level(i)
        if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            self.state = "title"

    def _customize_events(self, event):
        if self.btn_cust_back.clicked(event):
            save_mod.save(self.data)
            self.state = "title"
            return
        if self.btn_icon_prev.clicked(event):
            self.data["icon"] = (self.data["icon"] - 1) % len(cubes.ICONS)
        if self.btn_icon_next.clicked(event):
            self.data["icon"] = (self.data["icon"] + 1) % len(cubes.ICONS)
        if self.btn_trail.clicked(event):
            self.data["trail"] = not self.data["trail"]
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            for i, r in enumerate(self.prim_rects):
                if r.collidepoint(event.pos):
                    self.data["primary"] = i
            for i, r in enumerate(self.sec_rects):
                if r.collidepoint(event.pos):
                    self.data["secondary"] = i
        if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            save_mod.save(self.data)
            self.state = "title"

    def _play_events(self, event):
        if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            self._stop_play()
            self.state = "select"

    def _overlay_events(self, event):
        if event.type == pygame.KEYDOWN:
            if event.key in (pygame.K_SPACE, pygame.K_UP, pygame.K_RETURN):
                if self.state == "dead":
                    self._restart_level()
                else:
                    self.state = "select"; self.music.stop()
            elif event.key == pygame.K_ESCAPE:
                self.state = "select"; self.music.stop()
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1 \
                and self.state == "dead":
            self._restart_level()

    # ── Level lifecycle ───────────────────────────────────────────────────────

    def _start_level(self, index):
        self.level = Level(index, SONGS[index])
        self.attempts = 0
        self._restart_level(first=True)
        self.music.play(index)

    def _restart_level(self, first=False):
        self.attempts += 1
        d = self.data
        self.cube = Cube(self.level, d["icon"], d["primary"], d["secondary"])
        self.camera.follow(self.cube.x)
        self.state = "play"
        if not first and self.music.current != self.level.index:
            self.music.play(self.level.index)

    def _stop_play(self):
        self.music.stop()
        self.level = None
        self.cube = None

    # ── Update ────────────────────────────────────────────────────────────────

    def update(self, dt, keys, events):
        self.bg_scroll += 4
        if self.state == "title":
            self._update_title_cube()
            return
        if self.state != "play" or self.cube is None:
            return

        jump_held = (keys[pygame.K_SPACE] or keys[pygame.K_UP]
                     or keys[pygame.K_w] or pygame.mouse.get_pressed()[0])
        self.cube.update(jump_held)
        self.camera.follow(self.cube.x)

        if self.cube.dead:
            pct = int(self.cube.progress * 100)
            save_mod.record_progress(self.data, self.level.index, pct)
            self.state = "dead"
        elif self.cube.finished:
            save_mod.record_progress(self.data, self.level.index, 100)
            self.state = "complete"

    def _update_title_cube(self):
        self._title_cube_vy += 0.7
        self._title_cube_y += self._title_cube_vy
        if self._title_cube_y >= 0:
            self._title_cube_y = 0
            self._title_cube_vy = -11

    # ── Draw ──────────────────────────────────────────────────────────────────

    def draw(self):
        if self.state == "title":
            self._draw_title()
        elif self.state == "select":
            self._draw_select()
        elif self.state == "customize":
            self._draw_customize()
        else:
            self._draw_play()
            if self.state == "dead":
                self._draw_dead()
            elif self.state == "complete":
                self._draw_complete()

    def _draw_title(self):
        scene.draw_background(self.screen, ((30, 30, 60), (70, 90, 160)),
                              self.bg_scroll)
        scene.draw_ground(self.screen, (40, 40, 80), self.bg_scroll)
        text(self.screen, "CUBE DASH", 76, WHITE, center=(WIDTH // 2, 150))
        text(self.screen, "A Geometry Dash style rhythm runner", 22, LIGHT_GRAY,
             center=(WIDTH // 2, 210))

        # Hopping preview cube using the player's customization.
        size = TILE
        cx = WIDTH // 2 - size // 2
        cy = GROUND_Y - size + int(self._title_cube_y)
        d = self.data
        surf = pygame.Surface((size, size), pygame.SRCALPHA)
        cubes.draw_cube(surf, pygame.Rect(0, 0, size, size),
                        d["icon"], d["primary"], d["secondary"])
        self.screen.blit(surf, (cx, cy))

        self.btn_play.draw(self.screen)
        self.btn_custom.draw(self.screen)
        self.btn_quit.draw(self.screen)
        text(self.screen, "Space / Up / Click to jump", 18, GRAY,
             center=(WIDTH // 2, HEIGHT - 28))

    def _draw_select(self):
        scene.draw_background(self.screen, ((25, 25, 45), (55, 55, 95)),
                              self.bg_scroll)
        text(self.screen, "THE MAIN TRACK", 52, WHITE, center=(WIDTH // 2, 90))
        text(self.screen, "7 levels - 7 original soundtracks", 20, LIGHT_GRAY,
             center=(WIDTH // 2, 140))

        for i, rect in enumerate(self.level_cards):
            song = SONGS[i]
            hovered = rect.collidepoint(pygame.mouse.get_pos())
            top, _ = song["theme"]
            pygame.draw.rect(self.screen, tuple(min(255, c + (40 if hovered else 0))
                                                for c in top), rect, border_radius=10)
            pygame.draw.rect(self.screen, UI_BORDER, rect, 2, border_radius=10)

            text(self.screen, f"{i + 1}", 30, WHITE, topleft=(rect.x + 14, rect.y + 10))
            text(self.screen, song["name"], 21, WHITE,
                 center=(rect.centerx, rect.y + 58))
            stars = "*" * song["difficulty"] + "." * (5 - song["difficulty"])
            text(self.screen, f"Difficulty {stars}", 16, GOLD,
                 center=(rect.centerx, rect.y + 90))
            best = int(self.data["best"].get(str(i), 0))
            done = i in self.data["completed"]
            label = "COMPLETE" if done else f"Best {best}%"
            text(self.screen, label, 16, GOOD if done else LIGHT_GRAY,
                 center=(rect.centerx, rect.y + 118))

        self.btn_select_back.draw(self.screen)

    def _draw_customize(self):
        scene.draw_background(self.screen, ((30, 25, 50), (60, 50, 100)),
                              self.bg_scroll)
        text(self.screen, "CUSTOMIZE", 52, WHITE, center=(WIDTH // 2, 80))

        d = self.data
        # Big preview.
        big = 130
        prect = pygame.Rect(330, 230, big, big)
        pygame.draw.rect(self.screen, UI_BG, prect.inflate(60, 60), border_radius=12)
        pygame.draw.rect(self.screen, UI_BORDER, prect.inflate(60, 60), 2, border_radius=12)
        cubes.draw_cube(self.screen, prect, d["icon"], d["primary"], d["secondary"])

        text(self.screen, "Shape", 20, LIGHT_GRAY, center=(388, 200))
        text(self.screen, cubes.ICONS[d["icon"]], 22, ACCENT, center=(388, 432))
        self.btn_icon_prev.draw(self.screen)
        self.btn_icon_next.draw(self.screen)

        self.btn_trail.label = f"Trail: {'On' if d['trail'] else 'Off'}"
        self.btn_trail.color = (40, 110, 70) if d["trail"] else (90, 60, 60)
        self.btn_trail.draw(self.screen)

        # Palettes.
        text(self.screen, "Primary", 20, LIGHT_GRAY, topleft=(720, 268))
        self._draw_swatches(self.prim_rects, d["primary"])
        text(self.screen, "Secondary", 20, LIGHT_GRAY, topleft=(720, 448))
        self._draw_swatches(self.sec_rects, d["secondary"])

        self.btn_cust_back.draw(self.screen)

    def _draw_swatches(self, rects, selected):
        for i, r in enumerate(rects):
            pygame.draw.rect(self.screen, cubes.PALETTE[i], r, border_radius=6)
            border = WHITE if i == selected else (20, 20, 28)
            pygame.draw.rect(self.screen, border, r, 4 if i == selected else 2,
                             border_radius=6)

    def _draw_play(self):
        song = self.level.song
        scene.draw_background(self.screen, song["theme"], self.camera.x)
        scene.draw_obstacles(self.screen, self.level, self.camera, song["theme"][1])
        scene.draw_finish(self.screen, self.level, self.camera)
        scene.draw_ground(self.screen, song["ground"], self.camera.x)
        self.cube.draw(self.screen, self.camera, self.data["trail"])
        self._draw_hud()

    def _draw_hud(self):
        # Progress bar.
        bar = pygame.Rect(WIDTH // 2 - 300, 26, 600, 18)
        pygame.draw.rect(self.screen, (0, 0, 0, 120), bar, border_radius=9)
        pygame.draw.rect(self.screen, UI_BG, bar, border_radius=9)
        fill = bar.copy()
        fill.width = int(bar.width * self.cube.progress)
        pygame.draw.rect(self.screen, GOOD, fill, border_radius=9)
        pygame.draw.rect(self.screen, WHITE, bar, 2, border_radius=9)
        text(self.screen, f"{int(self.cube.progress * 100)}%", 16, WHITE,
             center=(bar.centerx, bar.centery))
        text(self.screen, self.level.song["name"], 22, WHITE,
             topleft=(20, 18))
        text(self.screen, f"Attempt {self.attempts}", 18, LIGHT_GRAY,
             topleft=(20, 48))

    def _draw_dead(self):
        self._dim()
        text(self.screen, "GAME OVER", 64, BAD, center=(WIDTH // 2, 240))
        text(self.screen, f"You reached {int(self.cube.progress * 100)}%",
             28, WHITE, center=(WIDTH // 2, 310))
        text(self.screen, f"Attempt {self.attempts}", 22, LIGHT_GRAY,
             center=(WIDTH // 2, 350))
        text(self.screen, "SPACE / Click to retry    -    Esc for levels",
             20, GRAY, center=(WIDTH // 2, 430))

    def _draw_complete(self):
        self._dim()
        text(self.screen, "LEVEL COMPLETE!", 64, GOOD, center=(WIDTH // 2, 250))
        text(self.screen, self.level.song["name"], 30, WHITE,
             center=(WIDTH // 2, 320))
        text(self.screen, f"Cleared in {self.attempts} attempt"
             + ("s" if self.attempts != 1 else ""),
             22, LIGHT_GRAY, center=(WIDTH // 2, 362))
        text(self.screen, "SPACE / Esc to return to levels",
             20, GRAY, center=(WIDTH // 2, 440))

    def _dim(self):
        ov = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
        ov.fill((0, 0, 0, 170))
        self.screen.blit(ov, (0, 0))
