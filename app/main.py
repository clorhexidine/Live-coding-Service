import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import DATABASE_URL, Base, engine
from app.migrate import run_migrations
from app.routers import auth, rooms

logger = logging.getLogger("uvicorn.error")


def _running_on_render() -> bool:
    return os.environ.get("RENDER", "").strip().lower() in ("true", "1", "yes")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Live coding service")

app.include_router(auth.router)
app.include_router(rooms.router)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def startup():
    if _running_on_render() and DATABASE_URL.lower().startswith("sqlite"):
        msg = (
            "На Render SQLite в контейнере НЕ сохраняется между деплоями и рестартами — "
            "пользователи и комнаты пропадают. Подключите PostgreSQL:\n"
            "1) Dashboard → New + → PostgreSQL (Free).\n"
            "2) Откройте созданную БД → Info / Connections → скопируйте «Internal Database URL».\n"
            "3) Web Service (этот сервис) → Environment → Add Environment Variable: "
            "имя DATABASE_URL, значение — вставленный URL (или используйте «Link»/«Connect» "
            "PostgreSQL к этому Web Service — тогда Render подставит DATABASE_URL сам).\n"
            "4) Environment → добавьте SECRET_KEY — одна длинная случайная строка (без смены "
            "сессии не слетит при совпадении ключа между деплоями).\n"
            "5) Save Changes → Manual Deploy. Локально без RENDER по-прежнему работает SQLite в ./data.db."
        )
        logger.error(msg)
        raise RuntimeError(msg)

    scheme = DATABASE_URL.split(":", 1)[0] if DATABASE_URL else "?"
    logger.info("Database driver: %s", scheme)

    Base.metadata.create_all(bind=engine)
    run_migrations()


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/home")
async def home():
    return FileResponse(STATIC_DIR / "home.html")


@app.get("/room/{room_id}")
async def room_page(room_id: int):
    return FileResponse(STATIC_DIR / "room.html")


@app.get("/join/{token}")
async def join_invite_page(token: str):
    return FileResponse(STATIC_DIR / "join.html")


# Старый путь без авторизации (для совместимости)
@app.get("/editor-local")
async def editor_local():
    return FileResponse(BASE_DIR / "index.html")
