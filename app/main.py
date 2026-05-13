from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine
from app.migrate import run_sqlite_migrations
from app.routers import auth, rooms

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Live coding service")

app.include_router(auth.router)
app.include_router(rooms.router)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    run_sqlite_migrations()


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/home")
async def home():
    return FileResponse(STATIC_DIR / "home.html")


@app.get("/room/{room_id}")
async def room_page(room_id: int):
    return FileResponse(STATIC_DIR / "room.html")


# Старый путь без авторизации (для совместимости)
@app.get("/editor-local")
async def editor_local():
    return FileResponse(BASE_DIR / "index.html")
