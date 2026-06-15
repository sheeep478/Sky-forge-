# 🟩 SkyForge

A small **Minecraft-like voxel sandbox** that runs in the browser — on desktop **and** mobile.
Build, mine, and explore procedurally generated blocky worlds with passive animals roaming around.

![mode: survival / creative](https://img.shields.io/badge/modes-survival%20%7C%20creative-5db85c)
![worlds: regular / flat / skyblock](https://img.shields.io/badge/worlds-regular%20%7C%20flat%20%7C%20skyblock-3a6ea5)

## Features

- **Two game modes**
  - **Survival** — health & hunger, fall damage, a starter kit, blocks go into your inventory when mined, limited stacks.
  - **Creative** — fly (double-tap *Space* / long-press jump on mobile), unlimited blocks, no damage.
- **Three world types** (plus a hidden fourth — the Nether)
  - **Regular** — rolling procedural terrain with hills, water, beaches, trees and underground ores.
  - **Flat** — a clean superflat canvas for building.
  - **Skyblock** — a single floating island in the void. Survive with what you have.
- **Nether portals** — build a 4×5 obsidian frame, light it (press **G** / the 🔥 button), and step through to travel to a fiery Nether dimension of netherrack, lava lakes and glowstone. Step back through to return.
- **Seeded worlds** — type a seed for a reproducible world, or leave it blank for a random one.
- **20+ block types** with procedurally generated pixel-art textures — grass, dirt, stone, cobble, mossy cobble, stone bricks, sand, gravel, planks, leaves, glass, bricks, snow, coal/iron/gold/diamond ore, obsidian, netherrack, glowstone — plus water, lava and bedrock.
- **Oriented logs** — logs face the direction you place them (vertical, or lying along X/Z).
- **Texture item icons** — the hotbar and inventory show each block's actual texture.
- **Mining, tools & crafting** — blocks have hardness; hold to break them. The right tool (pickaxe / axe / shovel) mines faster, and stone & ores only drop when mined with a pickaxe. Mine logs → craft planks → sticks → tools in the crafting menu (☰).
- **Furnace & smelting** — craft a furnace (8 cobblestone) and interact with it (▣ / right-click) to smelt: iron/gold ore → ingots, sand → glass, cobble → stone. Smelting burns fuel (coal, planks or logs).
- **Four tool tiers** — wooden, stone, **iron** (from smelted ingots) and **diamond** (from mined diamonds) pickaxes, axes, shovels and swords, each faster than the last.
- **Day/night cycle & lighting** — a real per-block light system: the sky brightens and darkens over an ~8-minute cycle, caves are dark, and **torches** (craft from coal + stick), glowstone and lava cast light that falls off with distance.
- **Hostile mobs & combat** — **zombies** spawn at night, chase you and deal damage; they burn off at dawn. Fight back with the break action — **swords** hit hardest — with knockback and health bars.
- **3 passive mobs** — 🐷 Pig, 🐮 Cow, 🐔 Chicken — boxy models that wander, follow the terrain, and animate as they walk.
- **Full mobile support** — on-screen joystick, look-to-drag, and jump / place / break buttons. Desktop gets mouse-look + keyboard.
- **A proper main menu** to pick mode, world type and seed, plus an in-game pause/inventory screen.

## Play

### On a computer — just open the file
Download/clone the repo and **double-click `index.html`** (or drag it into your
browser). No server or build step needed.

### On a phone, or to share a link
Phones can't open local files easily, so host the folder. Two options:

**A. GitHub Pages (easiest — gives a public URL):**
In your repo on GitHub → **Settings → Pages** → set *Source* to your branch and
`/ (root)` → save. After a minute it's live at
`https://<you>.github.io/Sky-forge-/`, openable on any phone.

**B. A quick local server** (then open it from your phone on the same Wi-Fi):
```bash
python3 -m http.server 8000      # or:  npx serve .
```
Open `http://<your-computer-ip>:8000` on the phone.

> The 3D engine (Three.js) is downloaded from a CDN on first run, so the very
> first load needs an internet connection. If it's blocked you'll see a notice.

## Controls

### Desktop
| Action | Key |
|---|---|
| Move | **W A S D** / arrow keys |
| Look | **Mouse** (click the world first to lock the cursor) |
| Jump | **Space** |
| Fly (creative) | double-tap **Space**, or **F** |
| Sprint | **Ctrl** (or **R**) |
| Descend (flying) | **Shift** |
| Break block | **Left click** |
| Place block | **Right click** |
| Select block | **1–9** or **scroll wheel** |
| Pause / menu | **Esc** |

### Mobile
- **Left joystick** — move (push to the edge to sprint).
- **Drag the right side of the screen** — look around.
- **⤒ button** — jump (long-press to toggle flight in creative).
- **▣ button** — place block · **⛏ button** — break block.
- Tap a **hotbar slot** to choose the active block.

## Project structure

```
index.html        Main menu, HUD, mobile controls, layout
css/style.css     All styling (responsive for phones)
js/
  main.js         Entry point: menu, render loop, input, survival systems
  world.js        Chunk storage, terrain generation, face-culled meshing
  player.js       First-person movement + AABB voxel collision
  mobs.js         Pig / cow / chicken models and wander AI
  blocks.js       Block definitions + procedural texture atlas
  noise.js        Seeded value-noise terrain generator
```

Built with [Three.js](https://threejs.org/). No build step required.
