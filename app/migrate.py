"""Миграции при старте: SQLite — ALTER; PostgreSQL — IF NOT EXISTS."""

import secrets

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.database import engine
from app.invites import CODE_ALPHABET, new_invite_code, new_invite_token
from app.models import Room


def run_sqlite_migrations():
    if not str(engine.url).startswith("sqlite"):
        return
    insp = inspect(engine)
    if "rooms" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("rooms")}
    with engine.begin() as conn:
        if "description" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN description TEXT"))
        if "invite_token" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN invite_token VARCHAR(64)"))
        if "invite_code" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN invite_code VARCHAR(6)"))
        if "room_password_hash" not in cols:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN room_password_hash VARCHAR(255)"))


def _postgres_add_room_columns():
    if not str(engine.url).startswith("postgresql"):
        return
    stmts = [
        "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64)",
        "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS invite_code VARCHAR(6)",
        "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_password_hash VARCHAR(255)",
    ]
    with engine.begin() as conn:
        for s in stmts:
            conn.execute(text(s))


def _backfill_room_invites():
    with Session(engine) as db:
        rooms = db.scalars(select(Room)).all()
        used = {r.invite_code for r in rooms if r.invite_code}
        for room in rooms:
            changed = False
            if not room.invite_token:
                room.invite_token = new_invite_token()
                changed = True
            if not room.invite_code:
                for _ in range(200):
                    c = new_invite_code()
                    if c not in used:
                        room.invite_code = c
                        used.add(c)
                        changed = True
                        break
                if not room.invite_code:
                    room.invite_code = "".join(
                        secrets.choice(CODE_ALPHABET) for _ in range(6)
                    )
                    used.add(room.invite_code)
                    changed = True
            if changed:
                db.add(room)
        db.commit()


def run_migrations():
    run_sqlite_migrations()
    _postgres_add_room_columns()
    _backfill_room_invites()
