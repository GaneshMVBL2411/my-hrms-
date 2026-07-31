from functools import lru_cache

from supabase import Client, create_client

from app.core.config import settings


@lru_cache
def get_supabase() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)


def upload_file(path: str, content: bytes, content_type: str) -> str:
    client = get_supabase()
    bucket = settings.SUPABASE_STORAGE_BUCKET
    client.storage.from_(bucket).upload(
        path, content, {"content-type": content_type, "upsert": "true"}
    )
    return client.storage.from_(bucket).get_public_url(path)
