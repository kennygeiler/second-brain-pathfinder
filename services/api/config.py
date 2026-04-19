"""Runtime configuration loaded from environment / .env."""
from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    vault_path: Path = Field(default=Path("./vault"))
    openai_api_key: str = Field(default="")
    openai_model: str = Field(default="gpt-4o-mini")

    neo4j_uri: str = Field(default="bolt://localhost:7687")
    neo4j_user: str = Field(default="neo4j")
    neo4j_password: str = Field(default="password_must_be_changed")
    auto_commit: bool = Field(default=False)

    firecrawl_api_key: str = Field(default="")
    firecrawl_base_url: str = Field(default="https://api.firecrawl.dev")
    nyc_dot_seed_urls: str = Field(default="")

    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)

    @property
    def vault(self) -> Path:
        return self.vault_path.expanduser().resolve()


settings = Settings()
