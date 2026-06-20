"""Beatability checker used to validate generated levels.

A depth-first search over the only meaningful choice the player has each frame —
whether to jump while grounded — with coarse state de-duplication so the search
stays bounded. Returns True if a survival path to the finish exists. This lets
the level generator guarantee every course it ships is actually clearable.
"""

from player import Cube


def beatable(level, cap: int = 2_000_000) -> bool:
    c = Cube(level, 0, 0, 7)

    def snap():
        return (c.x, c.y, c.vy, c.on_ground)

    def restore(s):
        c.x, c.y, c.vy, c.on_ground = s
        c.dead = False
        c.finished = False
        c.trail = []

    def key():
        return (int(c.x // 4), round(c.vy * 2) / 2, c.on_ground, int(c.y // 8))

    seen = set()
    stack = [snap()]
    iters = 0
    while stack:
        iters += 1
        if iters > cap:
            return False               # treat an over-long search as unfair
        s = stack.pop()
        restore(s)
        k = key()
        if k in seen:
            continue
        seen.add(k)
        opts = (True, False) if c.on_ground else (False,)
        for opt in opts:
            restore(s)
            c.update(opt)
            if c.finished:
                return True
            if c.dead:
                continue
            stack.append(snap())
    return False
