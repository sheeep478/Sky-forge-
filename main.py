"""Entry point — run this file to start the game."""

import sys
import pygame

from config import WIDTH, HEIGHT, FPS, TITLE
from game   import Game


def main() -> None:
    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption(TITLE)
    clock  = pygame.time.Clock()

    game = Game(screen)

    while True:
        dt     = clock.tick(FPS) / 1000.0
        events = pygame.event.get()
        keys   = pygame.key.get_pressed()

        for event in events:
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            game.handle_event(event, events)

        game.update(dt, keys, events)
        game.draw()
        pygame.display.flip()


if __name__ == "__main__":
    main()
