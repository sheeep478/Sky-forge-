"""A horizontally-scrolling camera that trails the cube."""

from config import WIDTH


class Camera:
    def __init__(self):
        self.x = 0.0

    def follow(self, player_x: float) -> None:
        # Keep the cube about a third of the way across the screen.
        self.x = player_x - WIDTH * 0.32
        if self.x < 0:
            self.x = 0.0

    def world_to_screen(self, wx: float) -> float:
        return wx - self.x
