# ── Display ──────────────────────────────────────────────────────────────────
WIDTH  = 1280
HEIGHT = 720
FPS    = 60
TITLE  = "PyMine"

# ── Block rendering ───────────────────────────────────────────────────────────
BLOCK_SIZE = 32          # pixels per block

# ── World ─────────────────────────────────────────────────────────────────────
WORLD_WIDTH  = 512       # blocks
WORLD_HEIGHT = 256       # blocks
SEA_LEVEL    = 96        # y-coordinate of sea/surface reference

# ── Physics ───────────────────────────────────────────────────────────────────
GRAVITY           = 0.55   # blocks/frame² (scaled by BLOCK_SIZE)
JUMP_POWER        = 12.0   # blocks/s upward impulse
WALK_SPEED        = 5.0    # blocks/s
FLY_SPEED         = 8.0    # blocks/s (creative)
TERMINAL_VELOCITY = 18.0   # blocks/s max downward

# ── Survival stats ────────────────────────────────────────────────────────────
MAX_HEALTH   = 20
MAX_HUNGER   = 20
HUNGER_TICK  = 1200     # frames between hunger drain
FALL_SAFE    = 3        # blocks of free-fall before damage starts

# ── Hotbar ────────────────────────────────────────────────────────────────────
HOTBAR_SLOTS = 9

# ── Colors ────────────────────────────────────────────────────────────────────
SKY_COLOR   = (135, 206, 235)
WHITE       = (255, 255, 255)
BLACK       = (0,   0,   0  )
DARK_GRAY   = (40,  40,  40 )
GRAY        = (120, 120, 120)
RED         = (220, 50,  50 )
GREEN       = (60,  180, 60 )
YELLOW      = (240, 210, 40 )
UI_BG       = (30,  30,  30 )
UI_BORDER   = (80,  80,  80 )
HEALTH_RED  = (200, 40,  40 )
HUNGER_GOLD = (200, 160, 40 )
