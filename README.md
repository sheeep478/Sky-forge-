# Cube Dash

A Geometry Dash–style rhythm runner built with Python + pygame. Guide an
auto-running cube through a course of spikes, blocks, and jump pads — one tap at
a time — across **7 levels, each with its own original soundtrack**.

![title](docs/title.png)

## Features

- **The Main Track — 7 levels / 7 songs.** Every level has its own
  procedurally-synthesized chiptune track, color theme, scroll speed, and
  difficulty (Stereo Sunrise → Final Circuit). No external/copyrighted audio:
  the music is generated from scratch at first launch and cached to `.gd_cache/`.
- **One-button gameplay.** Tap/hold **Space**, **Up/W**, or **click** to jump.
  Hold to auto-hop. Land on blocks, bounce off yellow pads, dodge the spikes.
- **Cube customization.** 8 icon shapes, a 12-color palette for both a primary
  and secondary color, and a toggleable motion trail. Your choices are saved.
- **Always-fair levels.** Each course is generated and then *proven beatable* by
  a built-in solver before you ever play it (with a guaranteed-clearable
  fallback), so no level is ever impossible.
- **Progress tracking.** Per-level best percentage, completion stars, and an
  attempt counter — all persisted between sessions in `gd_save.json`.

## Run it

```bash
pip install -r requirements.txt
python main.py
```

> First launch spends ~1 second synthesizing the 7 soundtracks, then caches them.
> If no audio device is available the game still runs (silently).

## Controls

| Action            | Keys                          |
|-------------------|-------------------------------|
| Jump              | `Space` / `Up` / `W` / Mouse  |
| Back / pause out  | `Esc`                         |
| Retry (on death)  | `Space` / Click               |

## Project layout

| File         | Responsibility                                            |
|--------------|-----------------------------------------------------------|
| `main.py`    | Entry point + game loop                                   |
| `game.py`    | State machine: title, level select, customize, play       |
| `level.py`   | Self-validating obstacle generator + level model          |
| `solver.py`  | DFS beatability checker used to validate levels           |
| `player.py`  | The cube: physics, collision, death, rendering            |
| `scene.py`   | Background, ground, and obstacle rendering                |
| `cubes.py`   | Customization palettes, icon shapes, and cube renderer    |
| `music.py`   | Procedural chiptune synthesizer + the 7 song definitions  |
| `camera.py`  | Horizontal scrolling camera                               |
| `menu.py`    | Reusable UI widgets (buttons, fonts)                      |
| `save.py`    | Persistent save data (customization, unlocks, bests)      |
| `config.py`  | Tunable constants (display, physics, colors)              |
