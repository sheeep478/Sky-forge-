// Items, tools, crafting recipes, block drops and mining math.
// Block items reuse their block id (0..99). Non-block items start at 100.
// Globals from earlier scripts: BLOCK, BLOCK_INFO, PALETTE, blockIcon,
// blockHardness, BLOCK_TOOL, NEEDS_TOOL.

const ITEM = {
  STICK: 100,
  COAL: 101,
  DIAMOND: 102,
  IRON_INGOT: 103,
  GOLD_INGOT: 104,
  W_PICK: 110, W_AXE: 111, W_SHOVEL: 112, W_SWORD: 113,
  S_PICK: 120, S_AXE: 121, S_SHOVEL: 122, S_SWORD: 123,
  I_PICK: 130, I_AXE: 131, I_SHOVEL: 132, I_SWORD: 133,
  D_PICK: 140, D_AXE: 141, D_SHOVEL: 142, D_SWORD: 143,
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
  [ITEM.I_PICK]:   { type: 'pickaxe', tier: 'iron',  speed: 6, attack: 4 },
  [ITEM.I_AXE]:    { type: 'axe',     tier: 'iron',  speed: 6, attack: 5 },
  [ITEM.I_SHOVEL]: { type: 'shovel',  tier: 'iron',  speed: 6, attack: 4 },
  [ITEM.I_SWORD]:  { type: 'sword',   tier: 'iron',  speed: 1, attack: 7 },
  [ITEM.D_PICK]:   { type: 'pickaxe', tier: 'diamond', speed: 8, attack: 5 },
  [ITEM.D_AXE]:    { type: 'axe',     tier: 'diamond', speed: 8, attack: 6 },
  [ITEM.D_SHOVEL]: { type: 'shovel',  tier: 'diamond', speed: 8, attack: 5 },
  [ITEM.D_SWORD]:  { type: 'sword',   tier: 'diamond', speed: 1, attack: 8 },
};

const ITEM_INFO = {
  [ITEM.STICK]:   { name: 'Stick' },
  [ITEM.COAL]:    { name: 'Coal' },
  [ITEM.DIAMOND]: { name: 'Diamond' },
  [ITEM.IRON_INGOT]: { name: 'Iron Ingot' },
  [ITEM.GOLD_INGOT]: { name: 'Gold Ingot' },
  [ITEM.W_PICK]:   { name: 'Wooden Pickaxe' },
  [ITEM.W_AXE]:    { name: 'Wooden Axe' },
  [ITEM.W_SHOVEL]: { name: 'Wooden Shovel' },
  [ITEM.W_SWORD]:  { name: 'Wooden Sword' },
  [ITEM.S_PICK]:   { name: 'Stone Pickaxe' },
  [ITEM.S_AXE]:    { name: 'Stone Axe' },
  [ITEM.S_SHOVEL]: { name: 'Stone Shovel' },
  [ITEM.S_SWORD]:  { name: 'Stone Sword' },
  [ITEM.I_PICK]:   { name: 'Iron Pickaxe' },
  [ITEM.I_AXE]:    { name: 'Iron Axe' },
  [ITEM.I_SHOVEL]: { name: 'Iron Shovel' },
  [ITEM.I_SWORD]:  { name: 'Iron Sword' },
  [ITEM.D_PICK]:   { name: 'Diamond Pickaxe' },
  [ITEM.D_AXE]:    { name: 'Diamond Axe' },
  [ITEM.D_SHOVEL]: { name: 'Diamond Shovel' },
  [ITEM.D_SWORD]:  { name: 'Diamond Sword' },
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
  { out: BLOCK.TORCH, n: 4, in: [[ITEM.COAL, 1], [ITEM.STICK, 1]] },
  { out: BLOCK.CRAFTING_TABLE, n: 1, in: [[BLOCK.PLANK, 4]] },
  { out: BLOCK.STONE_BRICK, n: 4, in: [[BLOCK.STONE, 4]] },
  { out: BLOCK.FURNACE, n: 1, in: [[BLOCK.COBBLE, 8]] },
  { out: ITEM.W_PICK, n: 1, in: [[BLOCK.PLANK, 3], [ITEM.STICK, 2]] },
  { out: ITEM.W_AXE, n: 1, in: [[BLOCK.PLANK, 3], [ITEM.STICK, 2]] },
  { out: ITEM.W_SHOVEL, n: 1, in: [[BLOCK.PLANK, 1], [ITEM.STICK, 2]] },
  { out: ITEM.W_SWORD, n: 1, in: [[BLOCK.PLANK, 2], [ITEM.STICK, 1]] },
  { out: ITEM.S_PICK, n: 1, in: [[BLOCK.COBBLE, 3], [ITEM.STICK, 2]] },
  { out: ITEM.S_AXE, n: 1, in: [[BLOCK.COBBLE, 3], [ITEM.STICK, 2]] },
  { out: ITEM.S_SHOVEL, n: 1, in: [[BLOCK.COBBLE, 1], [ITEM.STICK, 2]] },
  { out: ITEM.S_SWORD, n: 1, in: [[BLOCK.COBBLE, 2], [ITEM.STICK, 1]] },
  { out: ITEM.I_PICK, n: 1, in: [[ITEM.IRON_INGOT, 3], [ITEM.STICK, 2]] },
  { out: ITEM.I_AXE, n: 1, in: [[ITEM.IRON_INGOT, 3], [ITEM.STICK, 2]] },
  { out: ITEM.I_SHOVEL, n: 1, in: [[ITEM.IRON_INGOT, 1], [ITEM.STICK, 2]] },
  { out: ITEM.I_SWORD, n: 1, in: [[ITEM.IRON_INGOT, 2], [ITEM.STICK, 1]] },
  { out: ITEM.D_PICK, n: 1, in: [[ITEM.DIAMOND, 3], [ITEM.STICK, 2]] },
  { out: ITEM.D_AXE, n: 1, in: [[ITEM.DIAMOND, 3], [ITEM.STICK, 2]] },
  { out: ITEM.D_SHOVEL, n: 1, in: [[ITEM.DIAMOND, 1], [ITEM.STICK, 2]] },
  { out: ITEM.D_SWORD, n: 1, in: [[ITEM.DIAMOND, 2], [ITEM.STICK, 1]] },
];

function canCraft(inv, r) { return r.in.every(([id, n]) => (inv[id] || 0) >= n); }

// Smelting (furnace). Each smelt needs one input and one unit of fuel.
const SMELTS = [
  { in: BLOCK.IRON_ORE, out: ITEM.IRON_INGOT },
  { in: BLOCK.GOLD_ORE, out: ITEM.GOLD_INGOT },
  { in: BLOCK.SAND, out: BLOCK.GLASS },
  { in: BLOCK.COBBLE, out: BLOCK.STONE },
];
const FUELS = [ITEM.COAL, BLOCK.PLANK, BLOCK.WOOD];   // priority order, 1 unit each
function fuelInInv(inv) { return FUELS.find((id) => (inv[id] || 0) > 0); }
function canSmelt(inv, s) { return (inv[s.in] || 0) > 0 && fuelInInv(inv) != null; }

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
  const bar = (x, col, hi) => { x.fillStyle = col; x.fillRect(6, 12, 20, 8); x.fillStyle = hi; x.fillRect(8, 13, 7, 2); };
  _itemIcons[ITEM.IRON_INGOT] = _icon((x) => bar(x, '#d4d4d4', '#f2f2f2'));
  _itemIcons[ITEM.GOLD_INGOT] = _icon((x) => bar(x, '#f0c632', '#fff0a0'));
  const heads = { wood: '#b08a52', stone: '#9a9a9a', iron: '#d8d8d8', diamond: '#4fe0d8' };
  const toolList = [
    [ITEM.W_PICK, 'wood', 'pickaxe'], [ITEM.W_AXE, 'wood', 'axe'], [ITEM.W_SHOVEL, 'wood', 'shovel'], [ITEM.W_SWORD, 'wood', 'sword'],
    [ITEM.S_PICK, 'stone', 'pickaxe'], [ITEM.S_AXE, 'stone', 'axe'], [ITEM.S_SHOVEL, 'stone', 'shovel'], [ITEM.S_SWORD, 'stone', 'sword'],
    [ITEM.I_PICK, 'iron', 'pickaxe'], [ITEM.I_AXE, 'iron', 'axe'], [ITEM.I_SHOVEL, 'iron', 'shovel'], [ITEM.I_SWORD, 'iron', 'sword'],
    [ITEM.D_PICK, 'diamond', 'pickaxe'], [ITEM.D_AXE, 'diamond', 'axe'], [ITEM.D_SHOVEL, 'diamond', 'shovel'], [ITEM.D_SWORD, 'diamond', 'sword'],
  ];
  for (const [id, tier, type] of toolList) _itemIcons[id] = _icon((x) => _tool(x, heads[tier], type));
}
function itemIcon(id) {
  if (isBlockItem(id)) return blockIcon(id);
  return _itemIcons[id] || '';
}
