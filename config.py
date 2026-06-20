"""Global constants for the Geometry Dash recreation."""

# ── Display ───────────────────────────────────────────────────────────────────
WIDTH  = 1280
HEIGHT = 720
FPS    = 60
TITLE  = "Cube Dash"

# ── World / grid ──────────────────────────────────────────────────────────────
TILE       = 40                 # pixels per grid cell
GROUND_Y   = HEIGHT - 140       # y of the top of the floor
CUBE_SIZE  = TILE               # the player cube is one tile

# ── Physics (pixels / frame at 60fps) ─────────────────────────────────────────
BASE_SPEED        = 6.4         # horizontal scroll speed (scaled per level)
GRAVITY           = 0.86
JUMP_VELOCITY     = -12.8
TERMINAL_VELOCITY = 22.0
ROT_SPEED         = 8.5         # degrees/frame the cube spins while airborne

# ── Colors ────────────────────────────────────────────────────────────────────
WHITE      = (255, 255, 255)
BLACK      = (0,   0,   0  )
GRAY       = (130, 130, 140)
DARK       = (24,  24,  34 )
LIGHT_GRAY = (200, 200, 210)
UI_BG      = (28,  28,  40 )
UI_BORDER  = (90,  90,  120)
ACCENT     = (90,  200, 255)
GOOD       = (70,  200, 110)
BAD        = (220, 70,  90 )
GOLD       = (245, 205, 70 )
