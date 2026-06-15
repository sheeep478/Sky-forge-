"""Game — ties together world, player, camera, HUD, and pause screen."""

import math
import pygame
from typing import Optional

from camera import Camera
from config import (WIDTH, HEIGHT, BLOCK_SIZE, WORLD_WIDTH, WORLD_HEIGHT,
                    WHITE, BLACK, DARK_GRAY, GRAY)
from menu   import Menu
from player import Player
from ui     import HUD
from world  import World
from blocks import Block, is_solid


class PauseScreen:
    def __init__(self):
        pygame.font.init()
        self._font_big  = pygame.font.SysFont("monospace", 42, bold=True)
        self._font_sm   = pygame.font.SysFont("monospace", 20)
        from menu import Button
        cx = WIDTH // 2
        self.btn_resume = Button(pygame.Rect(cx - 120, 320, 240, 50), "Resume")
        self.btn_quit   = Button(pygame.Rect(cx - 120, 390, 240, 50),
                                 "Quit to Menu",
                                 color=(100, 40, 40), hover=(140, 60, 60))

    def draw(self, screen: pygame.Surface) -> None:
        ov = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
        ov.fill((0, 0, 0, 160))
        screen.blit(ov, (0, 0))

        title = self._font_big.render("Paused", True, WHITE)
        screen.blit(title, (WIDTH // 2 - title.get_width() // 2, 230))

        hint = self._font_sm.render("Press  Esc  to resume", True, GRAY)
        screen.blit(hint, (WIDTH // 2 - hint.get_width() // 2, 285))

        self.btn_resume.draw(screen)
        self.btn_quit.draw(screen)

    def handle_event(self, event) -> str:
        """Returns 'resume', 'menu', or ''."""
        if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            return "resume"
        if self.btn_resume.is_clicked(event):
            return "resume"
        if self.btn_quit.is_clicked(event):
            return "menu"
        return ""


class Game:
    """
    State machine
    -------------
    "menu"   → Menu is active
    "play"   → In-game
    "paused" → Pause overlay
    """

    def __init__(self, screen: pygame.Surface):
        self.screen = screen
        self.state  = "menu"

        self.menu   = Menu()
        self.pause  = PauseScreen()
        self.hud    = HUD()

        self.world:  Optional[World]  = None
        self.player: Optional[Player] = None
        self.camera: Optional[Camera] = None

        # Mouse state
        self._lmb_held = False
        self._rmb_held = False
        self._last_rmb = 0   # tick of last place (throttle)

    # ── Public interface ──────────────────────────────────────────────────────

    def handle_event(self, event: pygame.event.Event, events: list) -> None:
        if self.state == "menu":
            self.menu.handle_event(event)
            if self.menu.state == "done":
                self._start_game()

        elif self.state == "paused":
            result = self.pause.handle_event(event)
            if result == "resume":
                self.state = "play"
                pygame.mouse.set_visible(False)
            elif result == "menu":
                self._go_menu()

        elif self.state == "play":
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                self.state = "paused"
                pygame.mouse.set_visible(True)
            if event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:
                    self._lmb_held = True
                if event.button == 3:
                    self._rmb_held = True
                    self._do_place()
            if event.type == pygame.MOUSEBUTTONUP:
                if event.button == 1:
                    self._lmb_held = False
                    if self.player:
                        self.player.stop_mine()
                if event.button == 3:
                    self._rmb_held = False

    def update(self, dt: float, keys, events: list) -> None:
        if self.state != "play":
            return
        if self.player is None or self.world is None:
            return

        self.player.update(dt, self.world, keys, events)
        self.camera.follow(*self.player.center_world,
                           WORLD_WIDTH, WORLD_HEIGHT)

        if self._lmb_held:
            bx, by = self._hovered_block()
            if bx is not None:
                self.player.start_mine(bx, by)
                self.player.update_mine(dt, self.world)

    def draw(self) -> None:
        if self.state == "menu":
            self.menu.draw(self.screen)
            return

        if self.world and self.camera:
            self.world.draw(self.screen, self.camera)

        if self.player:
            self.player.draw(self.screen, self.camera)
            hov_block = self._hovered_block_type()
            self.hud.draw(self.screen, self.player, hov_block)
            self._draw_block_highlight()

        if self.state == "paused":
            self.pause.draw(self.screen)

    # ── Internals ─────────────────────────────────────────────────────────────

    def _start_game(self) -> None:
        tmpl = self.menu.chosen_template
        mode = self.menu.chosen_mode
        seed = self.menu.seed

        self.world  = World(WORLD_WIDTH, WORLD_HEIGHT)
        self.camera = Camera(WIDTH, HEIGHT)

        self.world.generate(tmpl, seed)
        sx, sy = self.world.spawn
        self.player = Player(sx, sy, mode=mode)

        # Camera snap
        self.camera.follow(*self.player.center_world,
                           WORLD_WIDTH, WORLD_HEIGHT)

        self.state = "play"
        pygame.mouse.set_visible(False)

    def _go_menu(self) -> None:
        self.state  = "menu"
        self.menu   = Menu()
        self.world  = None
        self.player = None
        self.camera = None
        pygame.mouse.set_visible(True)

    def _hovered_block(self):
        """Return (bx, by) of the block the cursor is pointing at."""
        if self.player is None or self.camera is None:
            return None, None
        mx, my = pygame.mouse.get_pos()
        wx, wy = self.camera.screen_to_world(mx, my)
        bx = int(wx // BLOCK_SIZE)
        by = int(wy // BLOCK_SIZE)

        # Reach check
        px, py = self.player.center_world
        dist = math.hypot(bx * BLOCK_SIZE + BLOCK_SIZE // 2 - px,
                          by * BLOCK_SIZE + BLOCK_SIZE // 2 - py) / BLOCK_SIZE
        if dist > self.player.reach:
            return None, None
        return bx, by

    def _hovered_block_type(self) -> Optional[int]:
        bx, by = self._hovered_block()
        if bx is None:
            return None
        return self.world.get_block(bx, by)

    def _do_place(self) -> None:
        if self.player is None:
            return
        bx, by = self._hovered_block()
        if bx is None:
            return
        # Try adjacent air block (place next to hovered solid)
        block = self.world.get_block(bx, by)
        if is_solid(block):
            # Find which face was clicked and place on that side
            mx, my = pygame.mouse.get_pos()
            wx, wy = self.camera.screen_to_world(mx, my)
            rx = wx - bx * BLOCK_SIZE
            ry = wy - by * BLOCK_SIZE
            # Pick the closest face
            dists = {
                "top":    ry,
                "bottom": BLOCK_SIZE - ry,
                "left":   rx,
                "right":  BLOCK_SIZE - rx,
            }
            face = min(dists, key=dists.get)
            nbx, nby = bx, by
            if face == "top":    nby -= 1
            elif face == "bottom": nby += 1
            elif face == "left":   nbx -= 1
            elif face == "right":  nbx += 1
            self.player.place_block(nbx, nby, self.world)
        else:
            self.player.place_block(bx, by, self.world)

    def _draw_block_highlight(self) -> None:
        bx, by = self._hovered_block()
        if bx is None:
            return
        sx, sy = self.camera.world_to_screen(bx * BLOCK_SIZE, by * BLOCK_SIZE)
        rect   = pygame.Rect(int(sx), int(sy), BLOCK_SIZE, BLOCK_SIZE)
        ov     = pygame.Surface((BLOCK_SIZE, BLOCK_SIZE), pygame.SRCALPHA)
        ov.fill((255, 255, 255, 60))
        self.screen.blit(ov, rect.topleft)
        pygame.draw.rect(self.screen, (255, 255, 255), rect, 2)
