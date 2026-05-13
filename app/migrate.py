"""Лёгкие миграции при старте (новые колонки SQLite и PostgreSQL)."""

import secrets

from sqlalchemy import inspect, select, text

from app.database import engine


_INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _random_invite_code() -> str:
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(6))


def backfill_room_invite_codes():
    """Заполняет invite_code у старых комнат, где колонка NULL."""
    from app.database import SessionLocal
    from app.models import Room

    db = SessionLocal()
    try:
        rooms = db.execute(select(Room).where(Room.invite_code.is_(None))).scalars().all()
        for room in rooms:
            for _ in range(80):
                cand = _random_invite_code()
                taken = db.execute(select(Room.id).where(Room.invite_code == cand)).first()
                if not taken:
                    room.invite_code = cand
                    break
        db.commit()
    finally:
        db.close()


def run_engine_migrations():
    insp = inspect(engine)
    if "rooms" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("rooms")}
    with engine.begin() as conn:
        if "description" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN description TEXT"))
        if "invite_code" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN invite_code VARCHAR(8)"))
        if "password_hash" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN password_hash VARCHAR(255)"))
    # Уникальный индекс по коду (идемпотентно)
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_rooms_invite_code "
                "ON rooms (invite_code) WHERE invite_code IS NOT NULL"
            )
        )


def run_sqlite_migrations():
    run_engine_migrations()
