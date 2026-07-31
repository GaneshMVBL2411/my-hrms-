from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    refresh_token_expiry,
    verify_password,
)
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import AuthUserOut, TokenResponse


def _user_query():
    return select(User).options(joinedload(User.role), joinedload(User.employee))


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = db.scalar(_user_query().where(User.email == email))
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def build_auth_user(user: User) -> AuthUserOut:
    return AuthUserOut(
        id=user.id,
        email=user.email,
        role=user.role.name,
        full_name=user.employee.full_name if user.employee else user.email,
        employee_id=user.employee.id if user.employee else None,
        photo_url=user.employee.photo_url if user.employee else None,
    )


def issue_tokens(db: Session, user: User) -> TokenResponse:
    access_token = create_access_token(subject=str(user.id), role=user.role.name)
    refresh_token = generate_refresh_token()

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(refresh_token),
            expires_at=refresh_token_expiry(),
        )
    )
    db.commit()

    return TokenResponse(access_token=access_token, refresh_token=refresh_token, user=build_auth_user(user))


def rotate_refresh_token(db: Session, refresh_token: str) -> TokenResponse | None:
    token_hash = hash_refresh_token(refresh_token)
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))

    if not stored or stored.revoked or stored.expires_at < datetime.now(timezone.utc):
        return None

    user = db.scalar(_user_query().where(User.id == stored.user_id))
    if not user or not user.is_active:
        return None

    stored.revoked = True
    db.add(stored)

    return issue_tokens(db, user)


def revoke_refresh_token(db: Session, refresh_token: str) -> None:
    token_hash = hash_refresh_token(refresh_token)
    stored = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if stored:
        stored.revoked = True
        db.commit()
