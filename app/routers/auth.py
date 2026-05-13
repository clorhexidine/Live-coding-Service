from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import create_access_token, hash_password, verify_password
from app.database import get_db
from app.deps import COOKIE_NAME as AUTH_COOKIE_NAME
from app.deps import get_current_user_optional
from app.models import User
from app.schemas import UserCreate, UserLogin, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_MAX_AGE = 7 * 24 * 60 * 60


def _cookie_secure(request: Request) -> bool:
    return request.url.scheme == "https"


@router.post("/register", response_model=UserOut)
def register(
    data: UserCreate,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    existing = db.execute(select(User).where(User.username == data.username)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Пользователь с таким логином уже есть")

    user = User(username=data.username, password_hash=hash_password(data.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    return user


@router.post("/login", response_model=UserOut)
def login(data: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.username == data.username)).scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    token = create_access_token(user.id)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
        max_age=COOKIE_MAX_AGE,
        path="/",
    )
    return user


@router.post("/logout")
def logout(request: Request, response: Response):
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
        secure=_cookie_secure(request),
        samesite="lax",
        httponly=True,
    )
    return {"ok": True}


@router.get("/me", response_model=UserOut | None)
def me(user: User | None = Depends(get_current_user_optional)):
    return user
