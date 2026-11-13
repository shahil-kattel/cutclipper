from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.pipeline.captions import build_ass
from app.pipeline.renderer import output_dimensions
from app.pipeline.types import Word
from app.schemas import (
    AspectRatio,
    CaptionSettings,
    ClipSettings,
    ExportQuality,
    ExportResolution,
)
from app.services.media import MediaTools, audio_bitrate_for, encoder_args


def _tools(encoder: str) -> MediaTools:
    return MediaTools(
        ffmpeg="ffmpeg",
        ffprobe="ffprobe",
        has_libass=True,
        video_encoder=encoder,
    )


def test_4k_dimensions_double_each_aspect() -> None:
    assert output_dimensions(AspectRatio.VERTICAL, ExportResolution.UHD_4K) == (2160, 3840)
    assert output_dimensions(AspectRatio.SQUARE, ExportResolution.UHD_4K) == (2160, 2160)
    assert output_dimensions(AspectRatio.PORTRAIT, ExportResolution.UHD_4K) == (2160, 2700)
    assert output_dimensions(AspectRatio.VERTICAL, ExportResolution.HD) == (1080, 1920)


def test_export_defaults_keep_existing_output() -> None:
    settings = ClipSettings()
    assert settings.resolution == ExportResolution.HD
    assert settings.export_quality == ExportQuality.HIGH


def test_lossless_forces_software_x264_crf_zero() -> None:
    args = encoder_args(
        _tools("h264_videotoolbox"),
        Settings(),
        width=2160,
        height=3840,
        quality="lossless",
    )
    assert args[args.index("-c:v") + 1] == "libx264"
    assert args[args.index("-crf") + 1] == "0"
    assert "h264_videotoolbox" not in args


def test_hardware_bitrate_scales_with_4k_pixels() -> None:
    args = encoder_args(
        _tools("h264_videotoolbox"),
        Settings(output_bitrate="8M"),
        width=2160,
        height=3840,
        quality="high",
    )
    assert args[args.index("-b:v") + 1] == "32M"
    maximum = encoder_args(
        _tools("h264_videotoolbox"),
        Settings(output_bitrate="8M"),
        width=2160,
        height=3840,
        quality="maximum",
    )
    assert maximum[maximum.index("-b:v") + 1] == "64M"


def test_audio_bitrate_rises_for_lossless() -> None:
    assert audio_bitrate_for("high") == "192k"
    assert audio_bitrate_for("maximum") == "320k"
    assert audio_bitrate_for("lossless") == "320k"


def test_caption_type_scales_for_4k(tmp_path: Path) -> None:
    words = [Word(0.0, 0.4, "hello")]
    output = tmp_path / "captions.ass"
    result = build_ass(
        words,
        clip_start=0.0,
        clip_duration=1.0,
        settings=CaptionSettings(enabled=True, font="Inter", font_size=80),
        output_size=(2160, 3840),
        output_path=output,
    )
    assert result.event_count > 0
    text = output.read_text(encoding="utf-8")
    assert "PlayResX: 2160" in text
    assert "PlayResY: 3840" in text
    # The 80 px preset is doubled for a 4K canvas instead of staying 80 px.
    assert "Style: CutClipper,Inter,160," in text
