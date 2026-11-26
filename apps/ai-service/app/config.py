from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Monorepo root .env, shared by every app.
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT_ENV, extra="ignore")

    ai_http_port: int = 8000
    ai_grpc_port: int = 50051
    redis_url: str = "redis://localhost:6379/0"
    job_events_grpc_url: str = "localhost:50052"
    ollama_base_url: str = "http://localhost:11434"
    media_root: Path = Path("~/.local/share/clipforge/media")
    vision_model: str = "qwen3-vl:4b-instruct"
    transcription_model: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    vision_max_frames: int = 60
    vision_batch_size: int = 2  # measured on the 6 GB GPU: 2 frames/request 6.7 s/frame vs 4 frames 12.0 s/frame
    vision_request_timeout: float = 300.0
    vision_tokens_per_frame: int = 250  # 180 cut answers off (invalid JSON)
    ollama_keep_alive: str = "5m"

    @field_validator("media_root")
    @classmethod
    def _expand_home(cls, v: Path) -> Path:
        return v.expanduser()
