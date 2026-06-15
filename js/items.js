// Items, tools, crafting recipes, block drops and mining math.
// Block items reuse their block id (0..99). Non-block items start at 100.
// Globals from earlier scripts: BLOCK, BLOCK_INFO, PALETTE, blockIcon,
// blockHardness, BLOCK_TOOL, NEEDS_TOOL.

const ITEM = {
  STICK: 100,
  COAL: 101,
  DIAMOND: 102,
  W_PICK: 110, W_AXE: 111, W_SHOVEL: 112, W_SWORD: 113,
  S_PICK: 120, S_AXE: 121, S_SHOVEL: 122, S_SWORD: 123,
};

// Tool stats: matching a block's preferred tool multiplies mining speed.
const TOOLS = {
  [ITEM.W_PICK]:   { type: 'pickaxe', tier: 'wood',  speed: 2, attack: 2 },
  [ITEM.W_AXE]:    { type: 'axe',     tier: 'wood',  speed: 2, attack: 3 },
  [ITEM.W_SHOVEL]: { type: 'shovel',  tier: 'wood',  speed: 2, attack: 2 },
  [ITEM.W_SWORD]:  { type: 'sword',   tier: 'wood',  speed: 1, attack: 4 },
  [ITEM.S_PICK]:   { type: 'pickaxe', tier: 'stone', speed: 4, attack: 3 },
  [ITEM.S_AXE]:    { type: 'axe',     tier: 'stone', speed: 4, attack: 4 },
  [ITEM.S_SHOVEL]: { type: 'shovel',  tier: 'stone', speed: 4, attack: 3 },
  [ITEM.S_SWORD]:  { type: 'sword',   tier: 'stone', speed: 1, attack: 6 },
};

const ITEM_INFO = {
  [ITEM.STICK]:   { name: 'Stick' },
  [ITEM.COAL]:    { name: 'Coal' },
  [ITEM.DIAMOND]: { name: 'Diamond' },
  [ITEM.W_PICK]:   { name: 'Wooden Pickaxe' },
  [ITEM.W_AXE]:    { name: 'Wooden Axe' },
  [ITEM.W_SHOVEL]: { name: 'Wooden Shovel' },
  [ITEM.W_SWORD]:  { name: 'Wooden Sword' },
  [ITEM.S_PICK]:   { name: 'Stone Pickaxe' },
  [ITEM.S_AXE]:    { name: 'Stone Axe' },
  [ITEM.S_SHOVEL]: { name: 'Stone Shovel' },
  [ITEM.S_SWORD]:  { name: 'Stone Sword' },
};

function isBlockItem(id) { return id < 100; }
function itemName(id) {
  return isBlockItem(id) ? (BLOCK_INFO[id] ? BLOCK_INFO[id].name : '?') : (ITEM_INFO[id] ? ITEM_INFO[id].name : '?');
}
function isTool(id) { return !!TOOLS[id]; }

// Crafting recipes — presented as a "recipe book" list.
const RECIPES = [
  { out: BLOCK.PLANK, n: 4, in: [[BLOCK.WOOD, 1]] },
  { out: ITEM.STICK, n: 4, in: [[BLOCK.PLANK, 2]] },
  { out: BLOCK.CRAFTING_TABLE, n: 1, in: [[BLOCK.PLANK, 4]] },
  { out: BLOCK.STONE_BRICK, n: 4, in: [[BLOCK.STONE, 4]] },
  { out: BLOCK.GLASS, n: 1, in: [[BLOCK.SAND, 1]] },  // "kiln-less" convenience
  { out: ITEM.W_PICK, n: 1, in: [[BLOCK.PLANK, 3], [ITEM.STICK, 2]] },
  { out: ITEM.W_AXE, n: 1, in: [[BLOCK.PLANK, 3], [ITEM.STICK, 2]] },
  { out: ITEM.W_SHOVEL, n: 1, in: [[BLOCK.PLANK, 1], [ITEM.STICK, 2]] },
  { out: ITEM.W_SWORD, n: 1, in: [[BLOCK.PLANK, 2], [ITEM.STICK, 1]] },
  { out: ITEM.S_PICK, n: 1, in: [[BLOCK.COBBLE, 3], [ITEM.STICK, 2]] },
  { out: ITEM.S_AXE, n: 1, in: [[BLOCK.COBBLE, 3], [ITEM.STICK, 2]] },
  { out: ITEM.S_SHOVEL, n: 1, in: [[BLOCK.COBBLE, 1], [ITEM.STICK, 2]] },
  { out: ITEM.S_SWORD, n: 1, in: [[BLOCK.COBBLE, 2], [ITEM.STICK, 1]] },
];

function canCraft(inv, r) { return r.in.every(([id, n]) => (inv[id] || 0) >= n); }

// Seconds to mine a block while holding `toolItem` (or null/0 for hand).
function miningTime(blockId, toolItem) {
  const h = blockHardness(blockId);
  if (!isFinite(h)) return Infinity;
  const need = BLOCK_TOOL[blockId];
  const t = TOOLS[toolItem];
  let mult = 1;
  if (t && need && t.type === need) mult = t.speed;
  return Math.max(0.05, h / mult);
}

// What a block drops when mined (null = nothing). Gated by needing a pickaxe.
function blockDrop(blockId, toolItem) {
  if (NEEDS_TOOL.has(blockId)) {
    const t = TOOLS[toolItem];
    if (!t || t.type !== 'pickaxe') return null;
  }
  switch (blockId) {
    case BLOCK.GRASS: return { id: BLOCK.DIRT, n: 1 };
    case BLOCK.STONE: return { id: BLOCK.COBBLE, n: 1 };
    case BLOCK.COAL_ORE: return { id: ITEM.COAL, n: 1 };
    case BLOCK.DIAMOND_ORE: return { id: ITEM.DIAMOND, n: 1 };
    case BLOCK.WOOD_X: case BLOCK.WOOD_Z: return { id: BLOCK.WOOD, n: 1 };
    case BLOCK.LEAVES: return null;
    case BLOCK.SNOW: return { id: BLOCK.SNOW, n: 1 };
    default: return { id: blockId, n: 1 };
  }
}

// ---- procedural icons for non-block items ----
let _itemIcons = {};
function _icon(draw) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  draw(x);
  return c.toDataURL ? c.toDataURL() : '';
}
function _tool(x, headColor, type) {
  // handle
  x.fillStyle = '#7a5a32';
  x.fillRect(19, 11, 4, 18);
  // head depends on type
  x.fillStyle = headColor;
  if (type === 'pickaxe') { x.fillRect(6, 6, 20, 4); x.fillRect(6, 6, 4, 5); x.fillRect(22, 6, 4, 5); }
  else if (type === 'axe') { x.fillRect(14, 4, 11, 10); x.fillRect(11, 6, 4, 7); }
  else if (type === 'shovel') { x.fillRect(15, 4, 12, 11); }
  else if (type === 'sword') { x.fillStyle = headColor; x.fillRect(18, 3, 4, 18); x.fillStyle = '#7a5a32'; x.fillRect(15, 21, 10, 3); x.fillRect(19, 23, 2, 6); }
}
function buildItemIcons() {
  if (Object.keys(_itemIcons).length) return;
  _itemIcons[ITEM.STICK] = _icon((x) => { x.fillStyle = '#8a6a3f'; x.save(); x.translate(16, 16); x.rotate(0.7); x.fillRect(-3, -12, 6, 24); x.restore(); });
  _itemIcons[ITEM.COAL] = _icon((x) => { x.fillStyle = '#1c1c1c'; x.beginPath(); x.arc(16, 16, 10, 0, 7); x.fill(); x.fillStyle = '#3a3a3a'; x.fillRect(11, 11, 3, 3); });
  _itemIcons[ITEM.DIAMOND] = _icon((x) => { x.fillStyle = '#4fe0d8'; x.beginPath(); x.moveTo(16, 5); x.lineTo(27, 15); x.lineTo(16, 28); x.lineTo(5, 15); x.closePath(); x.fill(); x.fillStyle = '#bff7f2'; x.fillRect(13, 11, 3, 3); });
  const woodHead = '#b08a52', stoneHead = '#9a9a9a';
  _itemIcons[ITEM.W_PICK] = _icon((x) => _tool(x, woodHead, 'pickaxe'));
  _itemIcons[ITEM.W_AXE] = _icon((x) => _tool(x, woodHead, 'axe'));
  _itemIcons[ITEM.W_SHOVEL] = _icon((x) => _tool(x, woodHead, 'shovel'));
  _itemIcons[ITEM.W_SWORD] = _icon((x) => _tool(x, woodHead, 'sword'));
  _itemIcons[ITEM.S_PICK] = _icon((x) => _tool(x, stoneHead, 'pickaxe'));
  _itemIcons[ITEM.S_AXE] = _icon((x) => _tool(x, stoneHead, 'axe'));
  _itemIcons[ITEM.S_SHOVEL] = _icon((x) => _tool(x, stoneHead, 'shovel'));
  _itemIcons[ITEM.S_SWORD] = _icon((x) => _tool(x, stoneHead, 'sword'));
}
function itemIcon(id) {
  if (isBlockItem(id)) return blockIcon(id);
  return _itemIcons[id] || '';
}
