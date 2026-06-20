"""Procedural chiptune music — 7 original looping tracks, one per level.

No external/copyrighted audio is used. Each track is synthesized from square
and triangle waves into a 16-bit WAV on first run and cached to `.gd_cache/`
so later launches are instant. If no audio device is available (e.g. a headless
machine) the game still runs silently.
"""

import math
import os
import struct
import wave

SAMPLE_RATE = 22050
CACHE_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".gd_cache")
CACHE_VER   = 3                       # bump to force regeneration

_A4 = 440.0
_NOTE_INDEX = {"C": -9, "D": -7, "E": -5, "F": -4,
               "G": -2, "A": 0, "B": 2}


def note_freq(name: str) -> float:
    """'A4', 'C#5', 'R' (rest) -> frequency in Hz (0.0 for a rest)."""
    if name == "R":
        return 0.0
    letter = name[0]
    i = 1
    semis = _NOTE_INDEX[letter]
    if len(name) > 1 and name[1] in "#b":
        semis += 1 if name[1] == "#" else -1
        i = 2
    octave = int(name[i:])
    semis += (octave - 4) * 12
    return _A4 * (2.0 ** (semis / 12.0))


# ── Song definitions ──────────────────────────────────────────────────────────
# Each song drives both the audio and the level's look/feel.
SONGS = [
    {
        "name": "Stereo Sunrise", "bpm": 130, "duty": 0.5,
        "theme": ((40, 60, 120), (90, 130, 210)),
        "ground": (30, 40, 90), "speed": 1.00, "difficulty": 1,
        "melody": "E4 G4 A4 G4 E4 D4 C4 D4 E4 G4 A4 B4 A4 G4 E4 R",
        "bass":   "C2 C2 G2 G2 A2 A2 F2 F2",
    },
    {
        "name": "Neon Pulse", "bpm": 140, "duty": 0.5,
        "theme": ((20, 70, 80), (40, 170, 180)),
        "ground": (15, 55, 60), "speed": 1.06, "difficulty": 2,
        "melody": "A4 A4 E4 A4 C5 B4 A4 G4 A4 A4 E4 G4 F4 E4 D4 R",
        "bass":   "A2 A2 E2 E2 F2 F2 G2 G2",
    },
    {
        "name": "Violet Drive", "bpm": 145, "duty": 0.35,
        "theme": ((60, 30, 100), (140, 80, 210)),
        "ground": (45, 25, 80), "speed": 1.12, "difficulty": 2,
        "melody": "D4 F4 A4 F4 D4 F4 C5 A4 D4 F4 A4 D5 C5 A4 F4 R",
        "bass":   "D2 D2 A2 A2 Bb2 Bb2 A2 A2",
    },
    {
        "name": "Crimson Rush", "bpm": 150, "duty": 0.5,
        "theme": ((110, 30, 40), (210, 70, 80)),
        "ground": (90, 25, 35), "speed": 1.18, "difficulty": 3,
        "melody": "E4 E4 G4 A4 A4 G4 E4 D4 E4 G4 A4 C5 B4 A4 G4 R",
        "bass":   "E2 E2 E2 G2 A2 A2 D2 D2",
    },
    {
        "name": "Golden Hour", "bpm": 138, "duty": 0.5,
        "theme": ((120, 80, 20), (235, 175, 60)),
        "ground": (95, 65, 20), "speed": 1.14, "difficulty": 3,
        "melody": "G4 A4 B4 D5 B4 A4 G4 E4 G4 A4 B4 C5 B4 G4 E4 R",
        "bass":   "G2 G2 D2 D2 E2 E2 C2 C2",
    },
    {
        "name": "Frostbyte", "bpm": 155, "duty": 0.25,
        "theme": ((20, 50, 90), (110, 180, 245)),
        "ground": (18, 42, 70), "speed": 1.24, "difficulty": 4,
        "melody": "C5 B4 A4 G4 A4 B4 C5 D5 E5 D5 C5 B4 A4 G4 E4 R",
        "bass":   "C2 C2 G2 G2 A2 A2 F2 G2",
    },
    {
        "name": "Final Circuit", "bpm": 162, "duty": 0.5,
        "theme": ((25, 25, 35), (120, 230, 130)),
        "ground": (20, 20, 28), "speed": 1.32, "difficulty": 5,
        "melody": "A4 C5 E5 C5 A4 G4 E4 G4 A4 C5 E5 A5 G5 E5 C5 R",
        "bass":   "A2 A2 E2 E2 F2 F2 G2 E2",
    },
]


def _envelope(i: int, total: int) -> float:
    """Attack/decay shaping so notes don't click."""
    attack = int(SAMPLE_RATE * 0.006)
    release = int(SAMPLE_RATE * 0.05)
    if i < attack:
        return i / attack
    if i > total - release:
        return max(0.0, (total - i) / release)
    return 1.0


def _square(phase: float, duty: float) -> float:
    return 1.0 if (phase % 1.0) < duty else -1.0


def _triangle(phase: float) -> float:
    p = phase % 1.0
    return 4.0 * abs(p - 0.5) - 1.0


def _render_voice(tokens, beat_dur, duty, vol, wave_fn, n_samples):
    """Render a sequence of notes into a float buffer of length n_samples."""
    buf = [0.0] * n_samples
    pos = 0
    for tok in tokens:
        freq = note_freq(tok)
        dur = int(beat_dur * SAMPLE_RATE)
        if pos >= n_samples:
            break
        if freq > 0:
            inv = freq / SAMPLE_RATE
            for i in range(dur):
                idx = pos + i
                if idx >= n_samples:
                    break
                env = _envelope(i, dur)
                buf[idx] += wave_fn(idx * inv, duty) * vol * env
        pos += dur
    return buf


def _wave_square(phase, duty):
    return _square(phase, duty)


def _wave_tri(phase, duty):
    return _triangle(phase)


def _synthesize(song) -> str:
    """Build (or reuse) the WAV file for a song and return its path."""
    idx = SONGS.index(song)
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"song_{idx}_v{CACHE_VER}.wav")
    if os.path.exists(path):
        return path

    beat_dur = 60.0 / song["bpm"] / 2.0          # eighth-note grid
    melody = song["melody"].split()
    bass = song["bass"].split()

    melody_samples = int(len(melody) * beat_dur * SAMPLE_RATE)
    # Repeat the bass to roughly span the melody length.
    bass_beat = beat_dur * 2.0
    reps = max(1, int(round((len(melody) * beat_dur) / (len(bass) * bass_beat))))
    bass = bass * reps
    total = melody_samples

    mel = _render_voice(melody, beat_dur, song["duty"], 0.32, _wave_square, total)
    bas = _render_voice(bass, bass_beat, 0.5, 0.30, _wave_tri, total)

    # Mix, soft-clip, and write 16-bit PCM.
    frames = bytearray()
    for i in range(total):
        v = mel[i] + bas[i]
        v = math.tanh(v)                          # gentle limiter
        frames += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 30000))

    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(bytes(frames))
    return path


class MusicPlayer:
    """Thin wrapper around pygame.mixer.music with graceful degradation."""

    def __init__(self):
        self.enabled = False
        self.current = -1
        try:
            import pygame
            pygame.mixer.pre_init(SAMPLE_RATE, -16, 1, 512)
            pygame.mixer.init()
            self.enabled = True
        except Exception:
            self.enabled = False

    def pregenerate(self) -> None:
        """Synthesize all tracks up front (first launch only)."""
        for song in SONGS:
            try:
                _synthesize(song)
            except Exception:
                pass

    def play(self, index: int, loop: bool = True) -> None:
        if not self.enabled:
            return
        try:
            import pygame
            path = _synthesize(SONGS[index])
            pygame.mixer.music.load(path)
            pygame.mixer.music.set_volume(0.55)
            pygame.mixer.music.play(-1 if loop else 0)
            self.current = index
        except Exception:
            pass

    def stop(self) -> None:
        if not self.enabled:
            return
        try:
            import pygame
            pygame.mixer.music.stop()
            self.current = -1
        except Exception:
            pass
