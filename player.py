"""Player — physics, inventory, mining, and placement."""

import pygame
from typing import List, Optional, Tuple

from blocks import (Block, BLOCK_DROPS, BLOCK_HARDNESS,
                    DEFAULT_HOTBAR, is_solid)
from camera import Camera
from config import (BLOCK_SIZE, WALK_SPEED, FLY_SPEED, GRAVITY,
                    JUMP_POWER, TERMINAL_VELOCITY, MAX_HEALTH,
                    MAX_HUNGER, HUNGER_TICK, FALL_SAFE, HOTBAR_SLOTS)

# Player bounding box in pixels (1 block wide × 2 blocks tall)
PW = BLOCK_SIZE - 4
PH = BLOCK_SIZE * 2 - 2

SPACE_DOUBLE_TAP = 250  # ms window for double-tap to toggle fly


class Player:
    def __init__(self, bx: int, by: int, mode: str = "survival"):
        self.x  = float(bx * BLOCK_SIZE)
        self.y  = float(by * BLOCK_SIZE)
        self.vx = 0.0
        self.vy = 0.0

        self.mode   = mode            # "survival" | "creative"
        self.flying = mode == "creative"

        # Survival stats
        self.health       = MAX_HEALTH
        self.hunger       = MAX_HUNGER
        self.hunger_timer = 0
        self._dmg_cd      = 0

        # Hotbar
        self.hotbar:   List[int] = list(DEFAULT_HOTBAR)
        self.counts:   List[int] = ([64] * HOTBAR_SLOTS
                                    if mode == "creative"
                                    else [0]  * HOTBAR_SLOTS)
        self.selected  = 0

        # Mining
        self.mine_target:   Optional[Tuple[int, int]] = None
        self.mine_progress: float = 0.0
        self.reach = 6   # blocks

        self.on_ground = False

        # Fall tracking (survival)
        self._fall_start_y: float = self.y

        # Double-tap space (creative fly toggle)
        self._last_space_ms = 0

    # ── Properties ───────────────────────────────────────────────────────────

    @property
    def rect(self) -> pygame.Rect:
        return pygame.Rect(int(self.x), int(self.y), PW, PH)

    @property
    def center_world(self) -> Tuple[float, float]:
        return self.x + PW / 2, self.y + PH / 2

    @property
    def block_x(self) -> int:
        return int((self.x + PW / 2) // BLOCK_SIZE)

    @property
    def block_y(self) -> int:
        return int((self.y + PH)     // BLOCK_SIZE)

    def selected_block(self) -> int:
        return self.hotbar[self.selected]

    # ── Inventory ─────────────────────────────────────────────────────────────

    def add_item(self, block: int, count: int = 1) -> None:
        # Try to stack onto existing slot
        for i, b in enumerate(self.hotbar):
            if b == block and self.counts[i] < 64:
                give = min(count, 64 - self.counts[i])
                self.counts[i] += give
                count -= give
                if count == 0:
                    return
        # Place in first empty slot
        for i in range(HOTBAR_SLOTS):
            if self.counts[i] == 0:
                self.hotbar[i] = block
                self.counts[i] = min(count, 64)
                return

    def consume_held(self) -> None:
        if self.mode == "creative":
            return
        if self.counts[self.selected] > 0:
            self.counts[self.selected] -= 1

    def can_place(self) -> bool:
        if self.mode == "creative":
            return self.hotbar[self.selected] != Block.AIR
        return self.counts[self.selected] > 0

    # ── Update ────────────────────────────────────────────────────────────────

    def update(self, dt: float, world, keys: pygame.key.ScancodeWrapper,
               events: list) -> None:
        self._handle_hotbar(events)
        self._handle_fly_toggle(events)

        if self.flying:
            self._update_flying(dt, keys)
        else:
            self._update_walking(dt, world, keys)

        self._move(dt, world)

        if self.mode == "survival":
            self._update_survival(dt)

        if self._dmg_cd > 0:
            self._dmg_cd -= 1

    def _handle_hotbar(self, events: list) -> None:
        for e in events:
            if e.type == pygame.KEYDOWN:
                if pygame.K_1 <= e.key <= pygame.K_9:
                    self.selected = e.key - pygame.K_1
            if e.type == pygame.MOUSEWHEEL:
                self.selected = (self.selected - e.y) % HOTBAR_SLOTS

    def _handle_fly_toggle(self, events: list) -> None:
        if self.mode != "creative":
            return
        for e in events:
            if e.type == pygame.KEYDOWN and e.key == pygame.K_SPACE:
                now = pygame.time.get_ticks()
                if now - self._last_space_ms < SPACE_DOUBLE_TAP:
                    self.flying = not self.flying
                    self.vy = 0.0
                self._last_space_ms = now

    def _update_flying(self, dt: float, keys) -> None:
        self.vx = 0.0
        self.vy = 0.0
        spd = FLY_SPEED * BLOCK_SIZE
        if keys[pygame.K_a] or keys[pygame.K_LEFT]:
            self.vx = -spd
        if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
            self.vx =  spd
        if keys[pygame.K_SPACE]:
            self.vy = -spd
        if keys[pygame.K_LSHIFT] or keys[pygame.K_RSHIFT]:
            self.vy =  spd

    def _update_walking(self, dt: float, world, keys) -> None:
        self.vx = 0.0
        spd = WALK_SPEED * BLOCK_SIZE
        if keys[pygame.K_a] or keys[pygame.K_LEFT]:
            self.vx = -spd
        if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
            self.vx =  spd

        # Gravity
        self.vy += GRAVITY * BLOCK_SIZE
        if self.vy > TERMINAL_VELOCITY * BLOCK_SIZE:
            self.vy = TERMINAL_VELOCITY * BLOCK_SIZE

        # Jump
        if (keys[pygame.K_SPACE] or keys[pygame.K_w] or keys[pygame.K_UP]) \
                and self.on_ground:
            self.vy = -JUMP_POWER * BLOCK_SIZE
            self.on_ground = False

    def _update_survival(self, dt: float) -> None:
        self.hunger_timer += 1
        if self.hunger_timer >= HUNGER_TICK:
            self.hunger_timer = 0
            if self.hunger > 0:
                self.hunger -= 1
            elif self.health > 1 and self._dmg_cd == 0:
                self.health -= 1
                self._dmg_cd = 40

        if self.health <= 0:
            self._respawn()

    def _respawn(self) -> None:
        self.health = MAX_HEALTH
        self.hunger = MAX_HUNGER

    # ── Physics / collision ───────────────────────────────────────────────────

    def _move(self, dt: float, world) -> None:
        # ── X ──
        self.x += self.vx * dt
        self._resolve_x(world)

        # ── Y ──
        prev_vy = self.vy
        self.y  += self.vy * dt
        self._resolve_y(world)

        # on_ground: just landed or standing still on solid below
        self.on_ground = self._probe_solid(world, 0, 2)

        # Fall-damage tracking
        if self.mode == "survival":
            if not self.on_ground:
                pass  # tracked via _fall_start_y when airborne
            else:
                fall_px = self.y - self._fall_start_y
                fall_blocks = fall_px / BLOCK_SIZE
                if fall_blocks > FALL_SAFE and self._dmg_cd == 0:
                    dmg = int(fall_blocks - FALL_SAFE)
                    self.health = max(0, self.health - dmg)
                    self._dmg_cd = 60
                self._fall_start_y = self.y

            if self.vy < 0:
                # Ascending — reset fall origin
                self._fall_start_y = self.y

    def _overlapping_blocks(self, world, ox: float = 0, oy: float = 0):
        r   = pygame.Rect(self.x + ox, self.y + oy, PW, PH)
        bs  = BLOCK_SIZE
        out = []
        for by in range(int(r.top // bs), int(r.bottom // bs) + 1):
            for bx in range(int(r.left // bs), int(r.right // bs) + 1):
                if world.is_solid(bx, by):
                    out.append(pygame.Rect(bx * bs, by * bs, bs, bs))
        return out

    def _probe_solid(self, world, ox: float, oy: float) -> bool:
        return len(self._overlapping_blocks(world, ox, oy)) > 0

    def _resolve_x(self, world) -> None:
        r = self.rect
        for br in self._overlapping_blocks(world):
            if not r.colliderect(br):
                continue
            if self.vx > 0:
                self.x = br.left - PW
            elif self.vx < 0:
                self.x = br.right
            self.vx = 0.0
            r = self.rect

    def _resolve_y(self, world) -> None:
        r = self.rect
        for br in self._overlapping_blocks(world):
            if not r.colliderect(br):
                continue
            if self.vy >= 0:          # falling / standing
                self.y  = br.top - PH
                self.vy = 0.0
            else:                      # rising
                self.y  = br.bottom
                self.vy = 0.0
            r = self.rect

    # ── Mining ────────────────────────────────────────────────────────────────

    def start_mine(self, bx: int, by: int) -> None:
        if (bx, by) != self.mine_target:
            self.mine_target   = (bx, by)
            self.mine_progress = 0.0

    def update_mine(self, dt: float, world) -> bool:
        """Returns True when the block is fully broken."""
        if self.mine_target is None:
            return False
        bx, by   = self.mine_target
        block    = world.get_block(bx, by)
        hardness = BLOCK_HARDNESS.get(block, 1.0)

        if hardness < 0:
            return False   # unbreakable

        if hardness == 0:
            self.mine_progress = 1.0
        else:
            self.mine_progress += dt / hardness

        if self.mine_progress >= 1.0:
            drop = BLOCK_DROPS.get(block)
            if drop is not None and self.mode == "survival":
                self.add_item(drop)
            world.set_block(bx, by, Block.AIR)
            self.mine_target   = None
            self.mine_progress = 0.0
            return True
        return False

    def stop_mine(self) -> None:
        self.mine_target   = None
        self.mine_progress = 0.0

    # ── Block placement ───────────────────────────────────────────────────────

    def place_block(self, bx: int, by: int, world) -> None:
        if not self.can_place():
            return
        block = self.hotbar[self.selected]
        if block == Block.AIR:
            return
        if world.get_block(bx, by) != Block.AIR:
            return

        # Prevent placing inside the player
        bs = BLOCK_SIZE
        pr = self.rect
        br = pygame.Rect(bx * bs, by * bs, bs, bs)
        if pr.colliderect(br):
            return

        world.set_block(bx, by, block)
        self.consume_held()

    # ── Drawing ───────────────────────────────────────────────────────────────

    def draw(self, screen: pygame.Surface, camera: Camera) -> None:
        sx, sy = camera.world_to_screen(self.x, self.y)
        sx, sy = int(sx), int(sy)

        # Legs
        leg_h = PH // 2
        pygame.draw.rect(screen, (60, 80, 160), (sx,          sy + leg_h, PW // 2 - 1, leg_h))
        pygame.draw.rect(screen, (60, 80, 160), (sx + PW // 2 + 1, sy + leg_h, PW // 2 - 1, leg_h))

        # Torso
        pygame.draw.rect(screen, (60, 120, 200), (sx, sy, PW, leg_h))

        # Head
        hs  = BLOCK_SIZE - 2
        hx  = sx + (PW - hs) // 2
        hy  = sy - hs
        pygame.draw.rect(screen, (255, 200, 150), (hx, hy, hs, hs))  # skin
        pygame.draw.rect(screen, (90, 55, 20),    (hx, hy, hs, hs), 1)  # outline

        # Eyes
        ey = hy + hs // 3
        pygame.draw.rect(screen, (30, 30, 30), (hx + 3,      ey, 4, 4))
        pygame.draw.rect(screen, (30, 30, 30), (hx + hs - 7, ey, 4, 4))

        # Mining crack overlay
        if self.mine_target and self.mine_progress > 0:
            bx, by_ = self.mine_target
            mx, my  = camera.world_to_screen(bx * BLOCK_SIZE, by_ * BLOCK_SIZE)
            ov      = pygame.Surface((BLOCK_SIZE, BLOCK_SIZE), pygame.SRCALPHA)
            alpha   = int(180 * self.mine_progress)
            ov.fill((0, 0, 0, alpha))
            screen.blit(ov, (int(mx), int(my)))
