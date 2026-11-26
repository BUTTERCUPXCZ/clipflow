"""Rendering against real FFmpeg on tiny generated videos (libx264: no GPU needed in tests)."""

import json
import shutil

import pytest

from app.jobs.rendering_job import RenderRequest, RenderRunner
from app.media.ffmpeg_runner import FfmpegCancelled, FfmpegError, FfmpegRunner
from app.media.media_paths import MediaPaths
from app.media.prober import MediaProber
from app.rendering import ass
from app.rendering.commands import filter_path, render_args
from app.rendering.profile import NVENC, X264, choose_encoder
from app.rendering.renderer import ClipRenderer, ClipSpec, RenderVerificationError
from tests.media_fixtures import videos  # noqa: F401  (pytest fixture)


class RecordingRenderEvents:
    def __init__(self, refuse: bool = False) -> None:
        self.progress: list[int] = []
        self.completion: tuple[str, dict] | None = None
        self.failure: tuple[str, str] | None = None
        self.refuse = refuse

    def render_progress(self, render_id, progress, message=""):
        self.progress.append(progress)
        return False

    def render_completed(self, render_id, output_path, metrics):
        self.completion = (output_path, metrics)
        return self.refuse

    def render_failed(self, render_id, code, message):
        self.failure = (code, message)


@pytest.fixture
def media(tmp_path, videos):  # noqa: F811
    (tmp_path / "src").mkdir()
    shutil.copy(videos.with_audio, tmp_path / "src/a.mp4")
    shutil.copy(videos.no_audio, tmp_path / "src/silent.mp4")
    return tmp_path


def runner(media, events, cancel=lambda _id: False, renderer=None):
    ffmpeg = FfmpegRunner(poll_interval=0.05, kill_grace=2)
    prober = MediaProber(ffmpeg)
    return RenderRunner(MediaPaths(media), prober, renderer or ClipRenderer(ffmpeg, prober, X264), events, cancel)


def request(source="src/a.mp4", clips=None, subtitles=True):
    cues = [{"start": 0.1, "end": 0.9, "text": "Hello {there}"}]
    return RenderRequest("r1", source, "analysis/j1/renders/r1", subtitles, clips or [ClipSpec("c1", 0.0, 1.5, cues)])


def test_renders_a_verified_vertical_clip_with_thumbnail_and_metadata(media):
    events = RecordingRenderEvents()

    runner(media, events).run(request())

    path, metrics = events.completion
    result = json.loads((media / path).read_text())
    clip = result["clips"][0]
    assert (clip["width"], clip["height"]) == (1080, 1920) and abs(clip["durationSeconds"] - 1.5) <= 0.5
    assert (media / clip["file"]).stat().st_size > 0 and (media / clip["thumbnail"]).exists()
    assert metrics == metrics | {"rendered": 1, "failed": 0, "encoder": "libx264"}
    assert not list((media / "analysis/j1/renders/r1").glob("*.ass"))  # temporary subtitle file removed
    assert events.progress[0] == 0


def test_a_video_without_audio_renders_without_an_audio_track(media):
    events = RecordingRenderEvents()
    runner(media, events).run(request(source="src/silent.mp4", subtitles=False))
    assert events.completion[1]["rendered"] == 1


def test_one_failed_clip_does_not_stop_the_others(media):
    class FlakyRenderer(ClipRenderer):
        def render(self, source, clip, out_dir, **kw):
            if clip.clip_id == "bad":
                raise RenderVerificationError("rendered 0.2 s, expected 1.5 s")
            return super().render(source, clip, out_dir, **kw)

    ffmpeg = FfmpegRunner()
    events = RecordingRenderEvents()
    clips = [ClipSpec("bad", 0, 1.5), ClipSpec("good", 0, 1.5)]

    runner(media, events, renderer=FlakyRenderer(ffmpeg, MediaProber(ffmpeg), X264)).run(request(clips=clips))

    result = json.loads((media / events.completion[0]).read_text())
    assert [c["clipId"] for c in result["clips"]] == ["good"]
    assert result["failures"] == [{"clipId": "bad", "error": "rendered 0.2 s, expected 1.5 s"}]


def test_no_clip_rendered_fails_and_cancel_or_refusal_leave_no_files(media):
    events = RecordingRenderEvents()
    runner(media, events).run(request(clips=[ClipSpec("c1", 0, 1.5)], source="src/missing.mp4"))
    assert events.failure[0] == "INTERNAL" and str(media) not in events.failure[1]

    events = RecordingRenderEvents()
    runner(media, events, cancel=lambda _id: True).run(request())
    assert events.failure[0] == "CANCELLED" and not (media / "analysis/j1/renders/r1").exists()

    events = RecordingRenderEvents(refuse=True)
    runner(media, events).run(request())
    assert not (media / "analysis/j1/renders/r1").exists()


def test_render_command_is_an_argument_list_with_blur_fit_loudness_and_fps_cap(tmp_path):
    args = render_args(tmp_path / "s.mp4", 10, 25.5, tmp_path / "o.mp4", X264, has_audio=True, source_fps=120,
                       subtitles=tmp_path / "c.ass")
    graph = args[args.index("-filter_complex") + 1]
    assert "boxblur" in graph and "overlay" in graph and f"ass={tmp_path / 'c.ass'}" in graph
    assert args[args.index("-t") + 1] == "15.500" and "loudnorm=I=-14:TP=-1.5:LRA=11" in args
    assert args[args.index("-r") + 1] == "60" and args[-1] == str(tmp_path / "o.mp4")
    with pytest.raises(ValueError):
        filter_path(tmp_path / "it's.ass")


def test_ass_neutralises_override_tags_and_formats_times():
    text = ass.to_ass([{"start": 61.234, "end": 62.5, "text": "a {\\b1} b\\N"}, {"start": 3, "end": 3, "text": "x"}])
    assert "Dialogue: 0,0:01:01.23,0:01:02.50,Caption,,0,0,0,,a (/b1) b/N" in text
    assert text.count("Dialogue:") == 1  # zero-length cue dropped


def test_encoder_choice_falls_back_to_x264_when_nvenc_cannot_encode():
    class Broken:
        def run(self, args, **kw):
            raise FfmpegError("no NVENC capable devices found")

    assert choose_encoder("auto", Broken()) is X264
    assert choose_encoder("x264", Broken()) is X264
    assert choose_encoder("nvenc", Broken()) is NVENC


def test_cancel_while_ffmpeg_runs_raises_cancelled(media):
    ffmpeg = FfmpegRunner(poll_interval=0.05, kill_grace=2)
    renderer = ClipRenderer(ffmpeg, MediaProber(ffmpeg), X264)
    from app.rendering.renderer import SourceInfo

    out = media / "out"
    out.mkdir()
    with pytest.raises(FfmpegCancelled):
        renderer.render(SourceInfo(media / "src/a.mp4", True, 25), ClipSpec("c", 0, 2.0), out,
                        subtitles=False, should_cancel=lambda: True)


class FakeProber:
    def __init__(self, duration: float) -> None:
        self.duration = duration

    def probe(self, path):
        from app.media.prober import ProbeResult

        return ProbeResult(decodable=True, duration_seconds=self.duration, width=1080, height=1920, has_audio=True)


class ScriptedFfmpeg:
    """Fails the first `fail` render commands; thumbnails succeed. Records which encoder each render used."""

    def __init__(self, fail: int = 0) -> None:
        self.fail = fail
        self.encoders: list[str] = []

    def run(self, args, **kw):
        if "-filter_complex" in args:
            self.encoders.append(args[args.index("-c:v") + 1])
            if self.fail:
                self.fail -= 1
                raise FfmpegError("no NVENC session available")
        from pathlib import Path

        Path(args[-1]).write_bytes(b"x")


def test_verification_rejects_a_wrong_duration_and_leaves_no_files(tmp_path):
    from app.rendering.renderer import SourceInfo

    renderer = ClipRenderer(ScriptedFfmpeg(), FakeProber(duration=3.0), X264)  # expected 2.0
    with pytest.raises(RenderVerificationError, match="expected 2.00 s"):
        renderer.render(SourceInfo(tmp_path / "s.mp4", True, 30), ClipSpec("c", 0, 2.0), tmp_path, subtitles=False)
    assert list(tmp_path.iterdir()) == []


def test_nvenc_failing_mid_render_falls_back_to_x264_once(tmp_path):
    from app.rendering.renderer import SourceInfo

    ffmpeg = ScriptedFfmpeg(fail=1)
    ClipRenderer(ffmpeg, FakeProber(duration=2.0), NVENC).render(
        SourceInfo(tmp_path / "s.mp4", True, 30), ClipSpec("c", 0, 2.0), tmp_path, subtitles=False
    )
    assert ffmpeg.encoders == ["h264_nvenc", "libx264"]


def test_an_ffmpeg_failure_on_one_clip_is_recorded_and_the_next_still_renders(media):
    class FirstFails(ClipRenderer):
        def render(self, source, clip, out_dir, **kw):
            if clip.clip_id == "bad":
                raise FfmpegError("ffmpeg exited with code 1")
            return super().render(source, clip, out_dir, **kw)

    ffmpeg = FfmpegRunner()
    events = RecordingRenderEvents()
    runner(media, events, renderer=FirstFails(ffmpeg, MediaProber(ffmpeg), X264)).run(
        request(clips=[ClipSpec("bad", 0, 1.5), ClipSpec("good", 0, 1.5)])
    )
    result = json.loads((media / events.completion[0]).read_text())
    assert [c["clipId"] for c in result["clips"]] == ["good"] and "code 1" in result["failures"][0]["error"]
