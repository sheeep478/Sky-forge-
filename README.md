# Sky-forge

## 🍔 Potassium Panic (web game)

A top-down chase game that runs entirely in your browser — open **`index.html`** and play.
You are **Frisk** (starts on the left side of the map), fleeing a sentient cheeseburger while
raiding **soup stores** for the single banana each one stocks. Collect every banana (potassium!)
to win.

**Play it online:** enable GitHub Pages for this repo (Settings → Pages → deploy from branch,
root folder) and the game will be served at your Pages URL, no build step needed.

### Features
- 🍲 Soup stores: walk in, grab the store's only banana, get out — burgers can't enter, but they camp the door
- 🛠 **Map maker**: paint terrain, place stores/spawns/burgers, save maps to your browser, export/import as JSON, playtest instantly
- 🎚 **Preset difficulties** (Chill / Normal / Spicy / Nightmare) + fully **custom game mode** with sliders (burger count & speed, stores, player speed, stamina, power-up rate, mustard)
- ⚡ Power-ups: speed boost, burger freeze, ghost mode
- 🟡 Mustard trails (Spicy+): the burger drips slowing condiment
- 🏃 Sprint with stamina, roads that speed you up, minimap, best-time records, particles & sound, pause menu
- 📱 Touch controls (virtual joystick + sprint button) on mobile

Controls: **WASD / arrows** move · **Shift** sprint · **P / Esc** pause.

## 🧱 Python minecraft-style game

The Python files (`main.py` etc.) are a separate pygame project:

```
pip install -r requirements.txt
python main.py
```
