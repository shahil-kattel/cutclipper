"""Cancellation-aware subprocess execution."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

from app.core.errors import JobCancelledError, ProcessingError

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ProcessResult:
    returncode: int
    stdout: str
    stderr: str
    stdout_lines: list[str] = field(default_factory=list)
    stderr_lines: list[str] = field(default_factory=list)


async def _terminate(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
    except (ProcessLookupError, PermissionError):
        return
    try:
        await asyncio.wait_for(proc.wait(), timeout=2.5)
        return
    except TimeoutError:
        pass
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError):
        return
    await proc.wait()


async def run_process(
    args: list[str],
    *,
    cancel_event: Event | None = None,
    timeout_seconds: float | None = None,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    on_stdout_line: Callable[[str], None] | None = None,
    on_stderr_line: Callable[[str], None] | None = None,
    max_capture_chars: int = 1_000_000,
) -> ProcessResult:
    """Run a process, streaming line callbacks while honoring cancellation.

    Cancellation raises :class:`JobCancelledError`; timeouts raise a
    :class:`ProcessingError` that includes the last diagnostic output.
    """

    if cancel_event is not None and cancel_event.is_set():
        raise JobCancelledError()

    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=os.name == "posix",
        # yt-dlp can emit a single multi-megabyte JSON line for format metadata.
        limit=16 * 1024 * 1024,
    )
    assert proc.stdout is not None
    assert proc.stderr is not None

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    stdout_chars = 0
    stderr_chars = 0

    async def pump(
        stream: asyncio.StreamReader,
        lines: list[str],
        callback: Callable[[str], None] | None,
        is_stderr: bool,
    ) -> None:
        nonlocal stdout_chars, stderr_chars
        while True:
            raw = await stream.readline()
            if not raw:
                break
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            if callback:
                try:
                    callback(line)
                except Exception:  # pragma: no cover - a callback must not kill I/O
                    logger.exception("process line callback failed")
            if is_stderr:
                if stderr_chars < max_capture_chars:
                    stderr_lines.append(line)
                    stderr_chars += len(line) + 1
            elif stdout_chars < max_capture_chars:
                stdout_lines.append(line)
                stdout_chars += len(line) + 1

    pump_out = asyncio.create_task(pump(proc.stdout, stdout_lines, on_stdout_line, is_stderr=False))
    pump_err = asyncio.create_task(pump(proc.stderr, stderr_lines, on_stderr_line, is_stderr=True))
    wait_task = asyncio.create_task(proc.wait())

    deadline = asyncio.get_running_loop().time() + timeout_seconds if timeout_seconds else None
    try:
        while not wait_task.done():
            if cancel_event is not None and cancel_event.is_set():
                await _terminate(proc)
                raise JobCancelledError()
            if deadline is not None and asyncio.get_running_loop().time() > deadline:
                await _terminate(proc)
                tail = "\n".join(stderr_lines[-20:])
                raise ProcessingError(
                    "A media operation timed out. Try a shorter video or lower clip settings.",
                    code="process_timeout",
                    retryable=True,
                    details={"stderr": tail},
                )
            await asyncio.wait({wait_task}, timeout=0.2)
        await asyncio.gather(pump_out, pump_err)
    except BaseException:
        if proc.returncode is None:
            await _terminate(proc)
        await asyncio.gather(pump_out, pump_err, return_exceptions=True)
        raise

    return ProcessResult(
        returncode=proc.returncode or 0,
        stdout="\n".join(stdout_lines),
        stderr="\n".join(stderr_lines),
        stdout_lines=stdout_lines,
        stderr_lines=stderr_lines,
    )
