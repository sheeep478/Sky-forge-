"""Camera — converts between world-pixel coords and screen coords."""

from config import WIDTH, HEIGHT, BLOCK_SIZE


class Camera:
    def __init__(self, view_w: int = WIDTH, view_h: int = HEIGHT):
        self.x      = 0.0
        self.y      = 0.0
        self.view_w = view_w
        self.view_h = view_h

    def follow(self, world_px: float, world_py: float,
               world_w: int, world_h: int) -> None:
        """Center the camera on (world_px, world_py), clamped to world bounds."""
        self.x = world_px - self.view_w / 2
        self.y = world_py - self.view_h / 2
        max_x  = world_w * BLOCK_SIZE - self.view_w
        max_y  = world_h * BLOCK_SIZE - self.view_h
        self.x = max(0.0, min(self.x, float(max_x)))
        self.y = max(0.0, min(self.y, float(max_y)))

    def world_to_screen(self, wx: float, wy: float):
        return wx - self.x, wy - self.y

    def screen_to_world(self, sx: float, sy: float):
        return sx + self.x, sy + self.y
