import os

# Локально: по умолчанию SQLite в каталоге проекта.
# На Render: в Dashboard → PostgreSQL → скопировать Internal Database URL
# в переменные Web Service как DATABASE_URL (данные переживают redeploy).
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def _normalize_database_url(url: str) -> str:
    """Render/Heroku отдают postgres:// — SQLAlchemy ожидает postgresql://."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


DATABASE_URL = _normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./data.db"))

connect_args: dict = {}
engine_kwargs: dict = {}

if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False
elif DATABASE_URL.startswith("postgresql"):
    engine_kwargs["pool_pre_ping"] = True

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
