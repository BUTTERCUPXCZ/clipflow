"""Planner prompts. The model proposes; code snaps, clamps and validates (it never gets the last word on times)."""

from app.planning.schemas import CANDIDATES_PER_WINDOW
from app.planning.timeline import Window


def candidates_prompt(window: Window, min_seconds: int, max_seconds: int) -> str:
    return (
        "You choose moments from a video that work as standalone short vertical clips (TikTok, Reels, Shorts).\n"
        "Below is part of the transcript with [start-end] times in seconds, and what is visible at some moments.\n"
        f"Pick the best {CANDIDATES_PER_WINDOW} moments or fewer. Prefer moments that make sense without the rest "
        "of the video: a complete statement, story, joke, strong reaction, insight, or an exciting play or "
        "highlight (for gameplay and streams, use what is visible too).\n"
        f"Each moment must be {min_seconds}-{max_seconds} seconds long and lie between {window.start:.1f} and "
        f"{window.end:.1f}. Take startSeconds and endSeconds from the transcript times.\n"
        "score: 1-10, where 10 would stop someone scrolling. reason: one short sentence.\n"
        "Always return at least one moment, the best available; a weak moment just gets a low score.\n"
        "Answer with JSON only.\n\n"
        f"{window.prompt_text()}"
    )


def copy_prompt(clips: list[dict], language: str) -> str:
    lines = [
        f'Clip {i} ({c["startSeconds"]:.1f}-{c["endSeconds"]:.1f} s): "{c["excerpt"][:1200]}"' for i, c in enumerate(clips)
    ]
    return (
        f"Write short-form social media copy for each clip below, in the language with code '{language}'.\n"
        "title: at most 8 words. hook: one line shown in the first second, at most 15 words. "
        "caption: one or two sentences for the post.\n"
        "Use only what is said in the clip; do not invent facts. Return one entry per clip with its index.\n"
        "Answer with JSON only.\n\n" + "\n".join(lines)
    )
