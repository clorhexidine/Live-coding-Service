import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Room, RoomComment, RoomFile, User, user_rooms
from app.schemas import (
    CommentOut,
    RoomCreate,
    RoomFileOut,
    RoomListItem,
    RoomOut,
    RoomStateIn,
    RoomUpdate,
)

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


def _user_has_room_access(db: Session, user_id: int, room_id: int) -> bool:
    row = db.execute(
        select(user_rooms.c.room_id).where(
            user_rooms.c.user_id == user_id,
            user_rooms.c.room_id == room_id,
        )
    ).first()
    return row is not None


def _get_room_or_403(db: Session, user: User, room_id: int) -> Room:
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    if not _user_has_room_access(db, user.id, room_id):
        raise HTTPException(status_code=403, detail="Нет доступа к комнате")
    return room


def _user_room_titles(db: Session, user_id: int) -> set[str]:
    rows = db.execute(
        select(Room.title)
        .join(user_rooms, Room.id == user_rooms.c.room_id)
        .where(user_rooms.c.user_id == user_id)
    ).all()
    out = set()
    for row in rows:
        if row[0]:
            out.add(row[0].strip())
    return out


def _default_room_title(db: Session, user_id: int) -> str:
    titles = _user_room_titles(db, user_id)
    n = db.execute(
        select(func.count()).select_from(user_rooms).where(user_rooms.c.user_id == user_id)
    ).scalar_one()
    k = int(n) + 1
    cand = f"Комната {k}"
    while cand in titles:
        k += 1
        cand = f"Комната {k}"
    return cand


def _room_to_out(db: Session, room: Room) -> RoomOut:
    files = (
        db.execute(
            select(RoomFile).where(RoomFile.room_id == room.id).order_by(RoomFile.sort_order, RoomFile.id)
        )
        .scalars()
        .all()
    )
    comments = (
        db.execute(select(RoomComment).where(RoomComment.room_id == room.id).order_by(RoomComment.id))
        .scalars()
        .all()
    )
    return RoomOut(
        id=room.id,
        title=room.title,
        description=room.description,
        owner_id=room.owner_id,
        files=[
            RoomFileOut(id=f.client_id, name=f.name, content=f.content or "")
            for f in files
        ],
        active_file_id=room.active_file_client_id,
        next_file_index=room.next_file_index or 2,
        comments=[
            CommentOut(
                id=c.client_comment_id,
                file_id=c.file_client_id,
                start=c.start_offset,
                end=c.end_offset,
                body=c.body or "",
            )
            for c in comments
        ],
    )


@router.get("", response_model=list[RoomListItem])
def list_rooms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = (
        select(Room)
        .join(user_rooms, Room.id == user_rooms.c.room_id)
        .where(user_rooms.c.user_id == user.id)
        .order_by(func.lower(func.coalesce(Room.title, "")).asc(), Room.id.asc())
    )
    rooms = db.scalars(q).all()
    return rooms


@router.post("", response_model=RoomListItem)
def create_room(
    data: RoomCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.title and data.title.strip():
        title = data.title.strip()
    else:
        title = _default_room_title(db, user.id)
    desc = data.description.strip() if data.description and data.description.strip() else None
    room = Room(title=title, description=desc, owner_id=user.id, next_file_index=2)
    db.add(room)
    db.flush()

    db.execute(insert(user_rooms).values(user_id=user.id, room_id=room.id))

    first_id = uuid.uuid4().hex[:16]
    room.active_file_client_id = first_id
    f = RoomFile(room_id=room.id, client_id=first_id, name="Файл 1", content="", sort_order=0)
    db.add(f)
    db.commit()
    db.refresh(room)
    return room


@router.get("/{room_id}", response_model=RoomOut)
def get_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    return _room_to_out(db, room)


@router.put("/{room_id}/state", response_model=RoomOut)
def save_room_state(
    room_id: int,
    body: RoomStateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)

    if not body.files:
        raise HTTPException(status_code=400, detail="Должен быть хотя бы один файл")

    db.execute(delete(RoomFile).where(RoomFile.room_id == room.id))

    for i, f in enumerate(body.files):
        db.add(
            RoomFile(
                room_id=room.id,
                client_id=f.id[:64],
                name=f.name[:255],
                content=f.content,
                sort_order=i,
            )
        )

    valid_ids = {f.id for f in body.files}
    if body.active_file_id and body.active_file_id in valid_ids:
        room.active_file_client_id = body.active_file_id[:64]
    else:
        room.active_file_client_id = body.files[0].id[:64]
    room.next_file_index = body.next_file_index

    content_lens = {f.id[:64]: len(f.content or "") for f in body.files}

    db.execute(delete(RoomComment).where(RoomComment.room_id == room.id))
    for c in body.comments:
        fid = c.file_id[:64]
        if fid not in content_lens:
            continue
        mx = content_lens[fid]
        s = max(0, min(c.start, mx))
        e = max(0, min(c.end, mx))
        if e < s:
            s, e = e, s
        if s == e:
            continue
        db.add(
            RoomComment(
                room_id=room.id,
                file_client_id=fid,
                client_comment_id=c.id[:64],
                start_offset=s,
                end_offset=e,
                body=c.body[:8000],
            )
        )

    db.commit()
    db.refresh(room)
    return _room_to_out(db, room)


def _require_room_owner(room: Room, user: User) -> None:
    if room.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Только владелец может изменять или удалять комнату")


@router.patch("/{room_id}", response_model=RoomListItem)
def update_room(
    room_id: int,
    data: RoomUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    if data.title is not None:
        room.title = data.title.strip()
    if data.description is not None:
        room.description = data.description
    db.commit()
    db.refresh(room)
    return room


@router.delete("/{room_id}")
def delete_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    db.delete(room)
    db.commit()
    return {"ok": True}
