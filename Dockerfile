# syntax=docker/dockerfile:1.7

# ---------- Frontend build ----------
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Runtime ----------
FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    CUTCLIPPER_ENVIRONMENT=production \
    CUTCLIPPER_DATA_DIR=/data \
    CUTCLIPPER_FRONTEND_DIST=/app/frontend/dist \
    CUTCLIPPER_FFMPEG_BINARY=/usr/bin/ffmpeg \
    CUTCLIPPER_FFPROBE_BINARY=/usr/bin/ffprobe \
    CUTCLIPPER_WHISPER_COMPUTE_TYPE=int8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libgomp1 \
        libgl1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        fonts-dejavu-core \
        fonts-liberation \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
# yt-dlp uses a JavaScript runtime for YouTube's player challenges.
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
COPY LICENSE /app/LICENSE
COPY README.md /app/README.md

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin cutclipper \
    && mkdir -p /data /home/cutclipper/.cache/huggingface \
    && chown -R cutclipper:cutclipper /app /data /home/cutclipper

USER cutclipper
ENV HOME=/home/cutclipper \
    HF_HOME=/home/cutclipper/.cache/huggingface

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=5)"

CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
