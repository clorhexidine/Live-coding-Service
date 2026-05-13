from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import decode_token
from app.database import get_db
from app.models import User

COOKIE_NAME = "access_token"


def get_current_user(
    db: Session = Depends(get_db),
    access_token: str | None = Cookie(None),
) -> User:
    if not access_token:
        raise HTTPException(status_code=401, detail="Не авторизован")
    user_id = decode_token(access_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Недействительная сессия")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user


def get_current_user_optional(
    db: Session = Depends(get_db),
    access_token: str | None = Cookie(None),
) -> User | None:
    if not access_token:
        return None
    user_id = decode_token(access_token)
    if user_id is None:
        return None
    return db.get(User, user_id)
