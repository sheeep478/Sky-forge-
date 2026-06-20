"""Cube Dash — a Geometry Dash style rhythm runner.

Run on desktop with `python main.py`, or build for mobile/web with pygbag
(`pygbag main.py`). The loop is async + `await asyncio.sleep(0)` per frame, which
is required by pygbag's WebAssembly runtime and harmless on desktop.
"""

import asyncio
import pygame

from config import WIDTH, HEIGHT, FPS, TITLE
from game import Game


async def main() -> None:
    pygame.init()
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    pygame.display.set_caption(TITLE)
    clock = pygame.time.Clock()

    game = Game(screen)

    running = True
    while running:
        clock.tick(FPS)
        events = pygame.event.get()
        keys = pygame.key.get_pressed()

        for event in events:
            if event.type == pygame.QUIT:
                running = False
            else:
                game.handle_event(event)

        game.update(1.0 / FPS, keys, events)
        game.draw()
        pygame.display.flip()

        # Yield to the browser event loop (required by pygbag; no-op on desktop).
        await asyncio.sleep(0)

    pygame.quit()


if __name__ == "__main__":
    asyncio.run(main())
