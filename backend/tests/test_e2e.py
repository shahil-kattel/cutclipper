"""Full pipeline test using a committed short clip with real speech.

Run with ``CUTCLIPPER_E2E=1 pytest -m e2e``. The first run downloads the tiny
Whisper model (~75 MB).
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

import pytest

from app.config import Settings
from app.pipeline.captions import build_ass
from app.pipeline.renderer import ClipRenderer, output_dimensions
from app.pipeline.selection import select_clips
from app.schemas import (
    AspectRatio,
    CaptionSettings,
    CaptionStyle,
    ClipSelectionMode,
    ClipSettings,
    ReframeMode,
    TransitionSettings,
    TransitionStyle,
)
from app.services.audio import analyze_energy, extract_audio
from app.services.media import get_media_tools, probe_media
from app.services.transcriber import transcribe_audio

pytestmark = pytest.mark.e2e


@pytest.mark.skipif(
    os.environ.get("CUTCLIPPER_E2E") != "1",
    reason="set CUTCLIPPER_E2E=1 to run the media pipeline test",
)
async def test_full_pipeline_creates_captioned_vertical_clips(tmp_path: Path) -> None:
    asset = Path(__file__).parent / "assets" / "sample-speech.mp4"
    assert asset.exists()
    tools = get_media_tools()
    assert tools.has_libass, "The E2E caption test requires FFmpeg with libass"

    settings = Settings(
        data_dir=tmp_path / "data",
        whisper_model="tiny",
        whisper_compute_type="auto",
        video_encoder="libx264",
        output_fps=30,
        output_crf=23,
        render_timeout_seconds=300,
    )
    settings.ensure_directories()
    media = await probe_media(str(asset))
    assert media.has_audio and media.duration > 10

    work = tmp_path / "work"
    work.mkdir()
    audio = await extract_audio(asset, work / "audio.wav", cancel_event=threading.Event())
    transcript = await transcribe_audio(
        audio,
        media.duration,
        settings,
        cancel_event=threading.Event(),
    )
    assert transcript.words, "Whisper should find speech in the sample"
    energy = await analyze_energy(audio)

    clip_settings = ClipSettings(
        clip_count=2,
        min_clip_seconds=5,
        max_clip_seconds=8,
        selection_mode=ClipSelectionMode.AUTO,
        aspect_ratio=AspectRatio.VERTICAL,
        reframe_mode=ReframeMode.CENTER,
        captions=CaptionSettings(
            enabled=True,
            style=CaptionStyle.KARAOKE,
            font="Inter",
            font_size=80,
            highlight_color="#22D3EE",
        ),
        transitions=TransitionSettings(
            enabled=True,
            style=TransitionStyle.FADE,
            duration=0.4,
        ),
    )
    selection = select_clips(
        duration=media.duration,
        settings=clip_settings,
        transcript=transcript,
        scenes=[],
        energy=energy,
    )
    assert len(selection.clips) == 2

    renderer = ClipRenderer(
        source=asset,
        media=media,
        settings=settings,
        clip_settings=clip_settings,
        work_dir=work,
        output_dir=tmp_path / "outputs",
        cancel_event=threading.Event(),
    )
    rendered = []
    for index, plan in enumerate(selection.clips, start=1):
        clip = await renderer.render(
            plan,
            index,
            transcript,
            on_stage=lambda *args: None,
            on_progress=lambda *args: None,
            title_slug="e2e",
        )
        rendered.append(clip)

    assert len(rendered) == 2
    expected_width, expected_height = output_dimensions(AspectRatio.VERTICAL)
    for clip in rendered:
        assert clip.video_path.exists()
        assert clip.thumbnail_path.exists()
        assert clip.width == expected_width
        assert clip.height == expected_height
        from app.services.media import probe_output_sync

        probe = probe_output_sync(clip.video_path)
        stream = probe["streams"][0]
        assert (stream["width"], stream["height"]) == (1080, 1920)
        assert stream["codec_name"] == "h264"
        assert stream["pix_fmt"] == "yuv420p"
        assert clip.video_path.stat().st_size > 50_000

    # The rendered captions are generated from real word timestamps.
    first_plan = selection.clips[0]
    words = transcript.words_between(first_plan.start, first_plan.end)
    ass_result = build_ass(
        words,
        clip_start=first_plan.start,
        clip_duration=first_plan.duration,
        settings=clip_settings.captions,
        output_size=(1080, 1920),
        output_path=tmp_path / "verify.ass",
    )
    assert ass_result.event_count > 0
    assert ass_result.word_count > 0
