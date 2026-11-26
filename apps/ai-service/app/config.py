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
    ollama_base_url: str = "http://localhost:11434"
    media_root: Path = Path("~/.local/share/clipforge/media")
    vision_model: str = "qwen3-vl:8b-instruct"
    transcription_model: str = "small"

    @field_validator("media_root")
    @classmethod
    def _expand_home(cls, v: Path) -> Path:
        return v.expanduser()
