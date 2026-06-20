"""Persistent save data: cube customization, unlocks, and best progress.

Stored as a small JSON file next to the game so choices survive restarts.
"""

import json
import os
from typing import Dict

SAVE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gd_save.json")

DEFAULT_DATA = {
    "icon":      0,          # index into cubes.ICONS
    "primary":   0,          # index into cubes.PALETTE
    "secondary": 7,          # index into cubes.PALETTE
    "trail":     True,
    "best":      {},         # level_index(str) -> best progress percent (int)
    "completed": [],         # list of completed level indices
}


def load() -> Dict:
    data = dict(DEFAULT_DATA)
    try:
        with open(SAVE_PATH, "r", encoding="utf-8") as fh:
            stored = json.load(fh)
        if isinstance(stored, dict):
            data.update(stored)
    except (OSError, ValueError):
        pass
    # Normalise the nested mutable fields
    data["best"]      = dict(data.get("best", {}))
    data["completed"] = list(data.get("completed", []))
    return data


def save(data: Dict) -> None:
    try:
        with open(SAVE_PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
    except OSError:
        pass


def record_progress(data: Dict, level_index: int, percent: int) -> None:
    key = str(level_index)
    if percent > int(data["best"].get(key, 0)):
        data["best"][key] = int(percent)
    if percent >= 100 and level_index not in data["completed"]:
        data["completed"].append(level_index)
    save(data)
