"""Render the 7 soundtracks to assets/music/song_<i>.ogg.

Run this whenever the song definitions in music.py change:

    pip install soundfile numpy        # build-time only; not a runtime dep
    python tools/render_music.py

OGG/Vorbis is compact and plays natively in browsers (pygbag/WASM) and on
desktop, so bundling these means the game never runs the slow pure-Python
synthesizer at launch — important for mobile.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np            # noqa: E402
import soundfile as sf        # noqa: E402

from music import SONGS, ASSET_DIR, SAMPLE_RATE, render_samples  # noqa: E402


def main() -> None:
    os.makedirs(ASSET_DIR, exist_ok=True)
    for i, song in enumerate(SONGS):
        samples = np.asarray(render_samples(song), dtype="float32")
        path = os.path.join(ASSET_DIR, f"song_{i}.ogg")
        sf.write(path, samples, SAMPLE_RATE, format="OGG", subtype="VORBIS")
        print(f"  song_{i}.ogg  {song['name']:<16} {os.path.getsize(path) // 1024} KiB")
    print(f"Done -> {ASSET_DIR}")


if __name__ == "__main__":
    main()
