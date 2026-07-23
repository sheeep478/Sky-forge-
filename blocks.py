"""
Block definitions.  Adding a new block requires:
  1. A new entry in Block enum
  2. BLOCK_COLORS entry  (top_color, side_color)  side_color=None → uniform
  3. BLOCK_HARDNESS entry  (-1 = unbreakable, 0 = instant)
  4. BLOCK_DROPS entry     (None = no drop)
  5. BLOCK_NAMES entry
"""

from enum import IntEnum
from typing import Dict, Optional, Tuple

Color = Tuple[int, int, int]


class Block(IntEnum):
    AIR          = 0
    GRASS        = 1
    DIRT         = 2
    STONE        = 3
    BEDROCK      = 4
    SAND         = 5
    GRAVEL       = 6
    WATER        = 7
    OAK_LOG      = 8
    OAK_LEAVES   = 9
    OAK_PLANKS   = 10
    GLASS        = 11
    COAL_ORE     = 12
    IRON_ORE     = 13
    GOLD_ORE     = 14
    DIAMOND_ORE  = 15
    COBBLESTONE  = 16
    CHERRY_LOG    = 17
    CHERRY_LEAVES = 18
    CHERRY_PLANKS = 19
    CHERRY_FENCE  = 20
    PINK_GLASS    = 21
    LADDER        = 22
    WHEAT         = 23


# (top_color, side_color)  — side_color=None means uniform
BLOCK_COLORS: Dict[int, Tuple[Color, Optional[Color]]] = {
    Block.AIR:         (None,              None),
    Block.GRASS:       ((86,  125, 70),    (134, 96,  67 )),
    Block.DIRT:        ((134, 96,  67 ),   None),
    Block.STONE:       ((128, 128, 128),   None),
    Block.BEDROCK:     ((55,  55,  55 ),   None),
    Block.SAND:        ((219, 208, 160),   None),
    Block.GRAVEL:      ((148, 140, 133),   None),
    Block.WATER:       ((64,  100, 200),   None),
    Block.OAK_LOG:     ((80,  60,  30 ),   None),
    Block.OAK_LEAVES:  ((67,  124, 59 ),   None),
    Block.OAK_PLANKS:  ((196, 161, 99 ),   None),
    Block.GLASS:       ((195, 220, 255),   None),
    Block.COAL_ORE:    ((128, 128, 128),   None),
    Block.IRON_ORE:    ((128, 128, 128),   None),
    Block.GOLD_ORE:    ((128, 128, 128),   None),
    Block.DIAMOND_ORE: ((128, 128, 128),   None),
    Block.COBBLESTONE: ((110, 110, 110),   None),
    Block.CHERRY_LOG:    ((62,  35,  44 ),  None),
    Block.CHERRY_LEAVES: ((235, 168, 195),  None),
    Block.CHERRY_PLANKS: ((226, 178, 172),  None),
    Block.CHERRY_FENCE:  ((208, 155, 150),  None),
    Block.PINK_GLASS:    ((245, 195, 221),  None),
    Block.LADDER:        ((176, 133, 80 ),  None),
    Block.WHEAT:         ((219, 190, 111),  None),
}

# Small pixel dots drawn on top of ore blocks to identify them
ORE_DOTS: Dict[int, Color] = {
    Block.COAL_ORE:    (30,  30,  30 ),
    Block.IRON_ORE:    (200, 175, 150),
    Block.GOLD_ORE:    (220, 185, 50 ),
    Block.DIAMOND_ORE: (100, 220, 240),
}

BLOCK_NAMES: Dict[int, str] = {
    Block.AIR:         "Air",
    Block.GRASS:       "Grass Block",
    Block.DIRT:        "Dirt",
    Block.STONE:       "Stone",
    Block.BEDROCK:     "Bedrock",
    Block.SAND:        "Sand",
    Block.GRAVEL:      "Gravel",
    Block.WATER:       "Water",
    Block.OAK_LOG:     "Oak Log",
    Block.OAK_LEAVES:  "Oak Leaves",
    Block.OAK_PLANKS:  "Oak Planks",
    Block.GLASS:       "Glass",
    Block.COAL_ORE:    "Coal Ore",
    Block.IRON_ORE:    "Iron Ore",
    Block.GOLD_ORE:    "Gold Ore",
    Block.DIAMOND_ORE: "Diamond Ore",
    Block.COBBLESTONE: "Cobblestone",
    Block.CHERRY_LOG:    "Cherry Log",
    Block.CHERRY_LEAVES: "Cherry Leaves",
    Block.CHERRY_PLANKS: "Cherry Planks",
    Block.CHERRY_FENCE:  "Cherry Fence",
    Block.PINK_GLASS:    "Pink Stained Glass",
    Block.LADDER:        "Ladder",
    Block.WHEAT:         "Wheat",
}

# Seconds to break with bare hand; -1 = unbreakable; 0 = instant
BLOCK_HARDNESS: Dict[int, float] = {
    Block.AIR:         0.0,
    Block.GRASS:       0.6,
    Block.DIRT:        0.5,
    Block.STONE:       7.5,
    Block.BEDROCK:    -1.0,
    Block.SAND:        0.5,
    Block.GRAVEL:      0.6,
    Block.WATER:       0.0,
    Block.OAK_LOG:     2.0,
    Block.OAK_LEAVES:  0.2,
    Block.OAK_PLANKS:  2.0,
    Block.GLASS:       0.3,
    Block.COAL_ORE:    7.5,
    Block.IRON_ORE:    7.5,
    Block.GOLD_ORE:    7.5,
    Block.DIAMOND_ORE: 7.5,
    Block.COBBLESTONE: 6.0,
    Block.CHERRY_LOG:    2.0,
    Block.CHERRY_LEAVES: 0.2,
    Block.CHERRY_PLANKS: 2.0,
    Block.CHERRY_FENCE:  2.0,
    Block.PINK_GLASS:    0.3,
    Block.LADDER:        0.4,
    Block.WHEAT:         0.0,
}

# What lands in the player's inventory when the block is broken (None = nothing)
BLOCK_DROPS: Dict[int, Optional[int]] = {
    Block.AIR:         None,
    Block.GRASS:       Block.DIRT,
    Block.DIRT:        Block.DIRT,
    Block.STONE:       Block.COBBLESTONE,
    Block.BEDROCK:     None,
    Block.SAND:        Block.SAND,
    Block.GRAVEL:      Block.GRAVEL,
    Block.WATER:       None,
    Block.OAK_LOG:     Block.OAK_LOG,
    Block.OAK_LEAVES:  None,
    Block.OAK_PLANKS:  Block.OAK_PLANKS,
    Block.GLASS:       None,
    Block.COAL_ORE:    Block.COAL_ORE,
    Block.IRON_ORE:    Block.IRON_ORE,
    Block.GOLD_ORE:    Block.GOLD_ORE,
    Block.DIAMOND_ORE: Block.DIAMOND_ORE,
    Block.COBBLESTONE: Block.COBBLESTONE,
    Block.CHERRY_LOG:    Block.CHERRY_LOG,
    Block.CHERRY_LEAVES: None,
    Block.CHERRY_PLANKS: Block.CHERRY_PLANKS,
    Block.CHERRY_FENCE:  Block.CHERRY_FENCE,
    Block.PINK_GLASS:    None,
    Block.LADDER:        Block.LADDER,
    Block.WHEAT:         Block.WHEAT,
}

# Default hotbar order shown when creating a new world
DEFAULT_HOTBAR = [
    Block.OAK_PLANKS,
    Block.DIRT,
    Block.STONE,
    Block.COBBLESTONE,
    Block.SAND,
    Block.GLASS,
    Block.OAK_LOG,
    Block.OAK_LEAVES,
    Block.GRAVEL,
]


def is_solid(block: int) -> bool:
    """Blocks with physical collision (player cannot pass through)."""
    return block not in (Block.AIR, Block.WATER, Block.OAK_LEAVES, Block.GLASS,
                         Block.CHERRY_LEAVES, Block.CHERRY_FENCE,
                         Block.PINK_GLASS, Block.LADDER, Block.WHEAT)


def is_transparent(block: int) -> bool:
    return block in (Block.AIR, Block.WATER, Block.OAK_LEAVES, Block.GLASS,
                     Block.CHERRY_LEAVES, Block.CHERRY_FENCE,
                     Block.PINK_GLASS, Block.LADDER, Block.WHEAT)
