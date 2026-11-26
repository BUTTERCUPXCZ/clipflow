"""Subtitle cues → an ASS file for FFmpeg's `ass` filter: bold white captions with a black outline, placed in the
lower blurred band of the blur-fit layout (the 16:9 picture occupies y 656–1264 of 1920)."""

from app.rendering.profile import HEIGHT, WIDTH

STYLE = (
    "Style: Caption,DejaVu Sans,72,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,"
    "-1,0,0,0,100,100,0,0,1,5,2,2,60,60,440,1"
)  # bold, outline 5, shadow 2, bottom-centre, 440 px above the bottom edge


def to_ass(cues: list[dict]) -> str:
    """`cues`: [{start, end, text}] in seconds from the clip start (Phase 5 subtitle cues)."""
    events = [
        f"Dialogue: 0,{_time(c['start'])},{_time(c['end'])},Caption,,0,0,0,,{_text(c['text'])}"
        for c in cues
        if c["end"] > c["start"] and c["text"].strip()
    ]
    return "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {WIDTH}",
            f"PlayResY: {HEIGHT}",
            "WrapStyle: 0",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
            "MarginR, MarginV, Encoding",
            STYLE,
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )


def _time(seconds: float) -> str:
    centis = max(0, round(seconds * 100))
    h, rest = divmod(centis, 360000)
    m, rest = divmod(rest, 6000)
    s, cs = divmod(rest, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _text(text: str) -> str:
    """Transcript text is untrusted: `{...}` would be read as ASS override tags and `\\` as an escape."""
    return " ".join(text.replace("\\", "/").replace("{", "(").replace("}", ")").split())
