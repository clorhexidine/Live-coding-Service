"""Лёгкие миграции SQLite при старте (новые колонки)."""

from sqlalchemy import inspect, text

from app.database import engine


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
