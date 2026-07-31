import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    return bool(
        settings.ZOHO_CLIENT_ID
        and settings.ZOHO_CLIENT_SECRET
        and settings.ZOHO_REFRESH_TOKEN
        and settings.ZOHO_ACCOUNT_ID
        and settings.ZOHO_FROM_EMAIL
    )


def _get_access_token() -> str | None:
    try:
        response = httpx.post(
            f"{settings.ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token",
            params={
                "refresh_token": settings.ZOHO_REFRESH_TOKEN,
                "client_id": settings.ZOHO_CLIENT_ID,
                "client_secret": settings.ZOHO_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        response.raise_for_status()
        return response.json()["access_token"]
    except Exception:
        logger.exception("Failed to refresh Zoho Mail access token")
        return None


def send_email(*, to: str, subject: str, body_html: str) -> bool:
    """Best-effort transactional email via the Zoho Mail API.

    Never raises — a notification failure must not break the leave/task/letter
    flow that triggered it. Returns False (and logs) if Zoho isn't configured
    or the send fails.
    """
    if not is_configured():
        logger.info("Zoho Mail not configured; skipping email to %s: %s", to, subject)
        return False

    access_token = _get_access_token()
    if not access_token:
        return False

    try:
        response = httpx.post(
            f"{settings.ZOHO_MAIL_DOMAIN}/api/accounts/{settings.ZOHO_ACCOUNT_ID}/messages",
            headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
            json={
                "fromAddress": settings.ZOHO_FROM_EMAIL,
                "toAddress": to,
                "subject": subject,
                "content": body_html,
                "mailFormat": "html",
            },
            timeout=10,
        )
        response.raise_for_status()
        return True
    except Exception:
        logger.exception("Failed to send notification email to %s", to)
        return False
