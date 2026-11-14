from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.pipeline.jobs import JobManager, JobRecord
from app.pipeline.types import ClipPlan, Word
from app.schemas import (
    CaptionSegment,
    CaptionSettings,
    ClipSettings,
    CreateJobRequest,
    JobMode,
    JobStatus,
    RestyleCaptionsRequest,
    VideoMetadata,
)


def _segment(start: float, end: float, text: str) -> CaptionSegment:
    return CaptionSegment(start=start, end=end, text=text)


def test_restyle_request_sorts_edited_lines() -> None:
    request = RestyleCaptionsRequest(
        captions=CaptionSettings(),
        segments=[_segment(1.0, 2.0, "second"), _segment(0.0, 1.0, "first")],
    )
    assert [segment.text for segment in request.segments or []] == ["first", "second"]


def test_restyle_request_rejects_overlapping_lines() -> None:
    with pytest.raises(ValidationError):
        RestyleCaptionsRequest(
            captions=CaptionSettings(),
            segments=[_segment(0.0, 1.2, "first"), _segment(1.0, 2.0, "second")],
        )


def test_clip_jobs_accept_edited_caption_lines() -> None:
    request = CreateJobRequest(
        upload_id="0" * 32,
        mode=JobMode.CLIPS,
        segments=[_segment(0.0, 1.0, "fixed line")],
    )
    assert [segment.text for segment in request.segments or []] == ["fixed line"]


def test_caption_lines_rebuild_the_editor_from_a_finished_clip_job(tmp_path) -> None:
    manager = JobManager(Settings(data_dir=tmp_path))
    record = JobRecord(
        id="clipjob",
        url="upload://source",
        settings=ClipSettings(),
        video=VideoMetadata(title="source", duration=2.0, source_url="upload://source"),
        caption_words=[Word(0.0, 0.5, "नमस्ते"), Word(0.5, 1.0, "संसार")],
    )
    manager.jobs[record.id] = record

    duration, segments, words = manager.caption_lines(record.id)
    assert duration == 2.0
    assert [segment.text for segment in segments] == ["नमस्ते संसार"]
    assert [word.text for word in words] == ["नमस्ते", "संसार"]


def test_restyle_can_replace_caption_text_as_well_as_style(tmp_path) -> None:
    source_path = tmp_path / "source.mp4"
    source_path.write_bytes(b"x")
    manager = JobManager(Settings(data_dir=tmp_path))
    source = JobRecord(
        id="sourcejob",
        url="upload://source",
        settings=ClipSettings(),
        upload_id="0" * 32,
        mode=JobMode.CLIPS,
        status=JobStatus.COMPLETED,
        video=VideoMetadata(title="source", duration=2.0, source_url="upload://source"),
        caption_words=[Word(0.0, 1.0, "wrong words")],
        clip_plans=[ClipPlan(start=0.0, end=1.0, score=90.0, selection_mode="auto")],
        source_path=source_path,
    )
    manager.jobs[source.id] = source

    edited = [_segment(0.0, 1.0, "fixed")]
    restyle = asyncio.run(
        manager.create_restyle_job(source.id, source.settings.captions, segments=edited)
    )

    assert [word.text for word in restyle.caption_words] == ["fixed"]
    assert [segment.text for segment in restyle.segments or []] == ["fixed"]
    assert restyle.clip_plans == source.clip_plans
