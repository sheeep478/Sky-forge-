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
  LEATHER: 105,
  W_PICK: 110, W_AXE: 111, W_SHOVEL: 112, W_SWORD: 113, W_HOE: 114,
  S_PICK: 120, S_AXE: 121, S_SHOVEL: 122, S_SWORD: 123, S_HOE: 124,
  I_PICK: 130, I_AXE: 131, I_SHOVEL: 132, I_SWORD: 133, I_HOE: 134,
  D_PICK: 140, D_AXE: 141, D_SHOVEL: 142, D_SWORD: 143,
  // farming + food
  WHEAT_SEEDS: 150, WHEAT: 151, BREAD: 152, PORKCHOP: 153, CHICKEN: 154,
  // armor
  L_HELM: 160, L_CHEST: 161, L_LEGS: 162, L_BOOTS: 163,
  I_HELM: 170, I_CHEST: 171, I_LEGS: 172, I_BOOTS: 173,
  // buckets + sheep
  BUCKET: 180, WATER_BUCKET: 181, LAVA_BUCKET: 182, MUTTON: 183,
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
  [ITEM.W_HOE]:    { type: 'hoe', tier: 'wood',  speed: 1, attack: 1 },
  [ITEM.S_HOE]:    { type: 'hoe', tier: 'stone', speed: 1, attack: 1 },
  [ITEM.I_HOE]:    { type: 'hoe', tier: 'iron',  speed: 1, attack: 1 },
};

// food: hunger restored + a little healing
const FOOD = {
  [ITEM.BREAD]:    { hunger: 5, heal: 0 },
  [ITEM.PORKCHOP]: { hunger: 3, heal: 1 },
  [ITEM.CHICKEN]:  { hunger: 2, heal: 1 },
  [ITEM.MUTTON]:   { hunger: 3, heal: 1 },
};
function isFood(id) { return !!FOOD[id]; }

// armor: which slot it fills + protection points
const ARMOR = {
  [ITEM.L_HELM]:  { slot: 'helmet', points: 1 }, [ITEM.L_CHEST]: { slot: 'chest', points: 3 },
  [ITEM.L_LEGS]:  { slot: 'legs',   points: 2 }, [ITEM.L_BOOTS]: { slot: 'boots', points: 1 },
  [ITEM.I_HELM]:  { slot: 'helmet', points: 2 }, [ITEM.I_CHEST]: { slot: 'chest', points: 6 },
  [ITEM.I_LEGS]:  { slot: 'legs',   points: 5 }, [ITEM.I_BOOTS]: { slot: 'boots', points: 2 },
};
function isArmor(id) { return !!ARMOR[id]; }

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
  [ITEM.W_HOE]: { name: 'Wooden Hoe' }, [ITEM.S_HOE]: { name: 'Stone Hoe' }, [ITEM.I_HOE]: { name: 'Iron Hoe' },
  [ITEM.LEATHER]: { name: 'Leather' },
  [ITEM.WHEAT_SEEDS]: { name: 'Wheat Seeds' }, [ITEM.WHEAT]: { name: 'Wheat' },
  [ITEM.BREAD]: { name: 'Bread' }, [ITEM.PORKCHOP]: { name: 'Porkchop' }, [ITEM.CHICKEN]: { name: 'Chicken' },
  [ITEM.L_HELM]: { name: 'Leather Helmet' }, [ITEM.L_CHEST]: { name: 'Leather Tunic' },
  [ITEM.L_LEGS]: { name: 'Leather Pants' }, [ITEM.L_BOOTS]: { name: 'Leather Boots' },
  [ITEM.I_HELM]: { name: 'Iron Helmet' }, [ITEM.I_CHEST]: { name: 'Iron Chestplate' },
  [ITEM.I_LEGS]: { name: 'Iron Leggings' }, [ITEM.I_BOOTS]: { name: 'Iron Boots' },
  [ITEM.BUCKET]: { name: 'Bucket' }, [ITEM.WATER_BUCKET]: { name: 'Water Bucket' },
  [ITEM.LAVA_BUCKET]: { name: 'Lava Bucket' }, [ITEM.MUTTON]: { name: 'Mutton' },
};

function isBlockItem(id) { return id < 100; }
function itemName(id) {
  return isBlockItem(id) ? (BLOCK_INFO[id] ? BLOCK_INFO[id].name : '?') : (ITEM_INFO[id] ? ITEM_INFO[id].name : '?');
}
function isTool(id) { return !!TOOLS[id]; }

// Shaped/shapeless crafting recipes (Minecraft-style 3x3 grid).
// rows+key define a shape ('.'=empty); shapeless lists ingredients in any layout.
function tool(out, mat, shape) {        // shape: 'pick'|'axe'|'shovel'|'sword'|'hoe'
  const rows = {
    pick:   ['MMM', '.S.', '.S.'],
    axe:    ['MM.', 'MS.', '.S.'],
    shovel: ['M', 'S', 'S'],
    sword:  ['M', 'M', 'S'],
    hoe:    ['MM.', '.S.', '.S.'],
  }[shape];
  return { out, n: 1, rows, key: { M: mat, S: ITEM.STICK } };
}
function armor(out, mat, piece) {        // piece: 'helmet'|'chest'|'legs'|'boots'
  const rows = {
    helmet: ['MMM', 'M.M'],
    chest:  ['M.M', 'MMM', 'MMM'],
    legs:   ['MMM', 'M.M', 'M.M'],
    boots:  ['M.M', 'M.M'],
  }[piece];
  return { out, n: 1, rows, key: { M: mat } };
}

const RECIPES = [
  { out: BLOCK.PLANK, n: 4, shapeless: [BLOCK.WOOD] },
  { out: ITEM.STICK, n: 4, rows: ['P', 'P'], key: { P: BLOCK.PLANK } },
  { out: BLOCK.TORCH, n: 4, rows: ['O', 'S'], key: { O: ITEM.COAL, S: ITEM.STICK } },
  { out: BLOCK.CRAFTING_TABLE, n: 1, rows: ['PP', 'PP'], key: { P: BLOCK.PLANK } },
  { out: BLOCK.CHEST, n: 1, rows: ['PPP', 'P.P', 'PPP'], key: { P: BLOCK.PLANK } },
  { out: BLOCK.FURNACE, n: 1, rows: ['CCC', 'C.C', 'CCC'], key: { C: BLOCK.COBBLE } },
  { out: BLOCK.BED, n: 1, rows: ['WWW', 'PPP'], key: { W: BLOCK.WOOL, P: BLOCK.PLANK } },
  { out: ITEM.BUCKET, n: 1, rows: ['I.I', '.I.'], key: { I: ITEM.IRON_INGOT } },
  { out: BLOCK.STONE_BRICK, n: 4, rows: ['TT', 'TT'], key: { T: BLOCK.STONE } },
  { out: ITEM.BREAD, n: 1, rows: ['WWW'], key: { W: ITEM.WHEAT } },
  tool(ITEM.W_PICK, BLOCK.PLANK, 'pick'), tool(ITEM.W_AXE, BLOCK.PLANK, 'axe'),
  tool(ITEM.W_SHOVEL, BLOCK.PLANK, 'shovel'), tool(ITEM.W_SWORD, BLOCK.PLANK, 'sword'), tool(ITEM.W_HOE, BLOCK.PLANK, 'hoe'),
  tool(ITEM.S_PICK, BLOCK.COBBLE, 'pick'), tool(ITEM.S_AXE, BLOCK.COBBLE, 'axe'),
  tool(ITEM.S_SHOVEL, BLOCK.COBBLE, 'shovel'), tool(ITEM.S_SWORD, BLOCK.COBBLE, 'sword'), tool(ITEM.S_HOE, BLOCK.COBBLE, 'hoe'),
  tool(ITEM.I_PICK, ITEM.IRON_INGOT, 'pick'), tool(ITEM.I_AXE, ITEM.IRON_INGOT, 'axe'),
  tool(ITEM.I_SHOVEL, ITEM.IRON_INGOT, 'shovel'), tool(ITEM.I_SWORD, ITEM.IRON_INGOT, 'sword'), tool(ITEM.I_HOE, ITEM.IRON_INGOT, 'hoe'),
  tool(ITEM.D_PICK, ITEM.DIAMOND, 'pick'), tool(ITEM.D_AXE, ITEM.DIAMOND, 'axe'),
  tool(ITEM.D_SHOVEL, ITEM.DIAMOND, 'shovel'), tool(ITEM.D_SWORD, ITEM.DIAMOND, 'sword'),
  armor(ITEM.L_HELM, ITEM.LEATHER, 'helmet'), armor(ITEM.L_CHEST, ITEM.LEATHER, 'chest'),
  armor(ITEM.L_LEGS, ITEM.LEATHER, 'legs'), armor(ITEM.L_BOOTS, ITEM.LEATHER, 'boots'),
  armor(ITEM.I_HELM, ITEM.IRON_INGOT, 'helmet'), armor(ITEM.I_CHEST, ITEM.IRON_INGOT, 'chest'),
  armor(ITEM.I_LEGS, ITEM.IRON_INGOT, 'legs'), armor(ITEM.I_BOOTS, ITEM.IRON_INGOT, 'boots'),
];

// ingredient totals (for the recipe list + auto-fill)
function recipeIn(r) {
  if (r._in) return r._in;
  const tot = {};
  if (r.shapeless) { for (const id of r.shapeless) tot[id] = (tot[id] || 0) + 1; }
  else for (const row of r.rows) for (const ch of row) if (ch !== '.') { const id = r.key[ch]; tot[id] = (tot[id] || 0) + 1; }
  r._in = Object.keys(tot).map((id) => [+id, tot[id]]);
  return r._in;
}
function canCraft(inv, r) { return recipeIn(r).every(([id, n]) => (inv[id] || 0) >= n); }
// does the recipe fit in a `cols`x`cols` grid? (2x2 inventory vs 3x3 table)
function recipeFits(r, cols) {
  if (r.shapeless) return r.shapeless.length <= cols * cols;
  const s = recipeShape(r);
  return s.w <= cols && s.h <= cols;
}

// ---- 3x3 grid matching (one item per cell) ----
function _trim(cells) {
  let minR = 3, maxR = -1, minC = 3, maxC = -1;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (cells[r][c]) {
    if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c;
  }
  if (maxR < 0) return { w: 0, h: 0, g: [] };
  const g = [];
  for (let r = minR; r <= maxR; r++) { const row = []; for (let c = minC; c <= maxC; c++) row.push(cells[r][c]); g.push(row); }
  return { w: maxC - minC + 1, h: maxR - minR + 1, g };
}
function recipeShape(r) {
  if (r._shape) return r._shape;
  const cells = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let rr = 0; rr < r.rows.length; rr++) for (let cc = 0; cc < r.rows[rr].length; cc++) {
    const ch = r.rows[rr][cc]; if (ch !== '.') cells[rr][cc] = r.key[ch];
  }
  r._shape = _trim(cells); return r._shape;
}
function gridShape(grid9) {
  return _trim([[grid9[0], grid9[1], grid9[2]], [grid9[3], grid9[4], grid9[5]], [grid9[6], grid9[7], grid9[8]]]);
}
function craftResult(grid9) {
  const have = {};
  let count = 0;
  for (const id of grid9) if (id) { have[id] = (have[id] || 0) + 1; count++; }
  if (count === 0) return null;
  const gs = gridShape(grid9);
  for (const r of RECIPES) {
    if (r.shapeless) {
      const need = {}; for (const id of r.shapeless) need[id] = (need[id] || 0) + 1;
      const nk = Object.keys(need);
      if (nk.length === Object.keys(have).length && nk.every((k) => need[k] === have[k])) return { out: r.out, n: r.n };
    } else {
      const rs = recipeShape(r);
      if (rs.w === gs.w && rs.h === gs.h) {
        let eq = true;
        for (let r2 = 0; r2 < rs.h && eq; r2++) for (let c2 = 0; c2 < rs.w; c2++) if (rs.g[r2][c2] !== gs.g[r2][c2]) { eq = false; break; }
        if (eq) return { out: r.out, n: r.n };
      }
    }
  }
  return null;
}

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
    case BLOCK.FARMLAND: case BLOCK.FARMLAND_WET: return { id: BLOCK.DIRT, n: 1 };
    case BLOCK.LEAVES: return null;
    // redstone: lit/on variants drop their placeable base form
    case BLOCK.REDSTONE_LAMP_ON: return { id: BLOCK.REDSTONE_LAMP, n: 1 };
    case BLOCK.LEVER_ON: return { id: BLOCK.LEVER, n: 1 };
    case BLOCK.BUTTON_ON: return { id: BLOCK.BUTTON, n: 1 };
    case BLOCK.REDSTONE_TORCH_OFF: return { id: BLOCK.REDSTONE_TORCH, n: 1 };
    case BLOCK.REPEATER_ON: return { id: BLOCK.REPEATER, n: 1 };
    case BLOCK.PISTON_HEAD: return null;
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
  else if (type === 'hoe') { x.fillRect(13, 5, 12, 4); x.fillRect(21, 5, 4, 6); }
}
// armor icons by slot
function _armorIcon(col, slot) {
  return _icon((x) => {
    x.fillStyle = col;
    if (slot === 'helmet') { x.fillRect(8, 7, 16, 10); x.clearRect(11, 13, 10, 4); }
    else if (slot === 'chest') { x.fillRect(7, 6, 18, 6); x.fillRect(9, 12, 14, 12); }
    else if (slot === 'legs') { x.fillRect(8, 6, 16, 8); x.fillRect(9, 14, 6, 12); x.fillRect(17, 14, 6, 12); }
    else if (slot === 'boots') { x.fillRect(8, 16, 7, 10); x.fillRect(17, 16, 7, 10); }
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(9, 8, 3, 2);
  });
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
  _itemIcons[ITEM.W_HOE] = _icon((x) => _tool(x, heads.wood, 'hoe'));
  _itemIcons[ITEM.S_HOE] = _icon((x) => _tool(x, heads.stone, 'hoe'));
  _itemIcons[ITEM.I_HOE] = _icon((x) => _tool(x, heads.iron, 'hoe'));

  _itemIcons[ITEM.LEATHER] = _icon((x) => { x.fillStyle = '#9a6a3a'; x.fillRect(7, 8, 18, 16); x.fillStyle = '#7a5028'; x.fillRect(10, 11, 4, 4); });
  _itemIcons[ITEM.WHEAT_SEEDS] = _icon((x) => { x.fillStyle = '#7aa83d'; for (const [px, py] of [[10, 12], [16, 16], [20, 11], [13, 19]]) x.fillRect(px, py, 3, 3); });
  _itemIcons[ITEM.WHEAT] = _icon((x) => { x.fillStyle = '#d8b23a'; x.fillRect(14, 6, 4, 20); x.fillStyle = '#e8d36a'; x.fillRect(10, 9, 12, 3); x.fillRect(11, 14, 10, 3); });
  _itemIcons[ITEM.BREAD] = _icon((x) => { x.fillStyle = '#b07a3a'; x.fillRect(6, 11, 20, 10); x.fillStyle = '#8a5a26'; x.fillRect(9, 13, 2, 6); x.fillRect(14, 13, 2, 6); x.fillRect(19, 13, 2, 6); });
  _itemIcons[ITEM.PORKCHOP] = _icon((x) => { x.fillStyle = '#e89aa6'; x.fillRect(8, 10, 16, 12); x.fillStyle = '#fff'; x.fillRect(20, 12, 4, 4); });
  _itemIcons[ITEM.CHICKEN] = _icon((x) => { x.fillStyle = '#f0cfa0'; x.fillRect(9, 10, 14, 12); x.fillStyle = '#cf9a5a'; x.fillRect(12, 13, 3, 4); });

  const armorCols = { L: '#9a6a3a', I: '#d4d4d4' };
  _itemIcons[ITEM.L_HELM] = _armorIcon(armorCols.L, 'helmet');
  _itemIcons[ITEM.L_CHEST] = _armorIcon(armorCols.L, 'chest');
  _itemIcons[ITEM.L_LEGS] = _armorIcon(armorCols.L, 'legs');
  _itemIcons[ITEM.L_BOOTS] = _armorIcon(armorCols.L, 'boots');
  _itemIcons[ITEM.I_HELM] = _armorIcon(armorCols.I, 'helmet');
  _itemIcons[ITEM.I_CHEST] = _armorIcon(armorCols.I, 'chest');
  _itemIcons[ITEM.I_LEGS] = _armorIcon(armorCols.I, 'legs');
  _itemIcons[ITEM.I_BOOTS] = _armorIcon(armorCols.I, 'boots');

  const bucket = (fill) => _icon((x) => {
    x.fillStyle = '#b8c0c8'; x.beginPath(); x.moveTo(8, 12); x.lineTo(24, 12); x.lineTo(21, 27); x.lineTo(11, 27); x.closePath(); x.fill();
    x.fillStyle = '#8a949c'; x.fillRect(8, 11, 16, 2);
    if (fill) { x.fillStyle = fill; x.fillRect(11, 14, 10, 5); }
  });
  _itemIcons[ITEM.BUCKET] = bucket(null);
  _itemIcons[ITEM.WATER_BUCKET] = bucket('#2b6fd6');
  _itemIcons[ITEM.LAVA_BUCKET] = bucket('#e2731a');
  _itemIcons[ITEM.MUTTON] = _icon((x) => { x.fillStyle = '#d98793'; x.fillRect(8, 11, 16, 11); x.fillStyle = '#fff'; x.fillRect(19, 13, 4, 4); });
}
function itemIcon(id) {
  if (isBlockItem(id)) return blockIcon(id);
  return _itemIcons[id] || '';
}
