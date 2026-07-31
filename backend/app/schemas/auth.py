from pydantic import EmailStr

from app.schemas.base import CamelModel


class LoginRequest(CamelModel):
    email: EmailStr
    password: str


class RefreshRequest(CamelModel):
    refresh_token: str


class LogoutRequest(CamelModel):
    refresh_token: str


class ChangePasswordRequest(CamelModel):
    current_password: str
    new_password: str


class AuthUserOut(CamelModel):
    id: int
    email: EmailStr
    role: str
    full_name: str
    employee_id: int | None
    photo_url: str | None


class TokenResponse(CamelModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: AuthUserOut
