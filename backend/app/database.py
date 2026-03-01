from typing import Optional

from supabase import Client, create_client

from .config import SUPABASE_KEY, SUPABASE_URL

_client: Optional[Client] = None


def get_db() -> Optional[Client]:
    global _client
    if _client is not None:
        return _client
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client

