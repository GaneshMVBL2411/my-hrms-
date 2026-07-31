from functools import lru_cache

from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ):
        # This machine has pre-existing shell/OS env vars (e.g. DATABASE_URL from other
        # projects) that must never shadow this project's own .env — dotenv wins.
        return init_settings, dotenv_settings, env_settings, file_secret_settings

    APP_NAME: str = "Whhohh Path HRMS"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_STORAGE_BUCKET: str = "hrms-files"

    # Zoho Mail API (OAuth) — used for transactional notification emails
    # (leave decisions, letters issued, task assignments, announcements).
    # Leave blank to disable emails entirely; sending is always best-effort.
    ZOHO_CLIENT_ID: str = ""
    ZOHO_CLIENT_SECRET: str = ""
    ZOHO_REFRESH_TOKEN: str = ""
    ZOHO_ACCOUNT_ID: str = ""
    ZOHO_FROM_EMAIL: str = ""
    ZOHO_ACCOUNTS_DOMAIN: str = "https://accounts.zoho.com"
    ZOHO_MAIL_DOMAIN: str = "https://mail.zoho.com"

    CORS_ORIGINS: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
