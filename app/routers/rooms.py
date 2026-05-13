import os
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password
from app.database import get_db
from app.deps import get_current_user, get_current_user_optional
from app.models import Room, RoomComment, RoomFile, User, user_rooms
from app.schemas import (
    CommentOut,
    RoomCreate,
    RoomCreatedOut,
    RoomJoinIn,
    RoomListItem,
    RoomLookupOut,
    RoomMemberOut,
    RoomOut,
    RoomSettingsOut,
    RoomSettingsPatch,
    RoomStateIn,
    RoomUpdate,
)

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

_INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _public_base_url(request: Request) -> str:
    env = (os.getenv("PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if env:
        return env
    return str(request.base_url).rstrip("/")


def _invite_link(request: Request, code: str) -> str:
    return f"{_public_base_url(request)}/join/{code}"


def _normalize_invite_code(code: str) -> str:
    raw = (code or "").strip().upper().replace(" ", "")
    return raw[:8]


def _generate_unique_invite_code(db: Session) -> str:
    for _ in range(120):
        cand = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(6))
        taken = db.execute(select(Room.id).where(Room.invite_code == cand)).first()
        if not taken:
            return cand
    raise HTTPException(status_code=500, detail="Не удалось сгенерировать код приглашения")


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


def _user_room_titles(db: Session, user_id: int, exclude_room_id: int | None = None) -> set[str]:
    q = (
        select(Room.title)
        .join(user_rooms, Room.id == user_rooms.c.room_id)
        .where(user_rooms.c.user_id == user_id)
    )
    if exclude_room_id is not None:
        q = q.where(Room.id != exclude_room_id)
    rows = db.execute(q).all()
    out = set()
    for row in rows:
        if row[0]:
            out.add(row[0].strip())
    return out


def _default_room_title(db: Session, user_id: int, exclude_room_id: int | None = None) -> str:
    titles = _user_room_titles(db, user_id, exclude_room_id)
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


def _require_room_owner(room: Room, user: User) -> None:
    if room.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Только владелец может выполнить это действие")


def _room_list_item(room: Room) -> RoomListItem:
    return RoomListItem(
        id=room.id,
        title=room.title,
        description=room.description,
        owner_id=room.owner_id,
    )


def _members_sorted(db: Session, room: Room) -> list[User]:
    rows = (
        db.execute(
            select(User)
            .join(user_rooms, User.id == user_rooms.c.user_id)
            .where(user_rooms.c.room_id == room.id)
        )
        .scalars()
        .all()
    )
    owner = db.get(User, room.owner_id)
    others = [u for u in rows if u.id != room.owner_id]
    others.sort(key=lambda u: (u.username or "").lower())
    out: list[User] = []
    if owner:
        out.append(owner)
    out.extend(others)
    return out


@router.get("/lookup/{code}", response_model=RoomLookupOut)
def lookup_room(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    norm = _normalize_invite_code(code)
    room = db.execute(select(Room).where(Room.invite_code == norm)).scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    is_member = bool(user and _user_has_room_access(db, user.id, room.id))
    return RoomLookupOut(
        room_id=room.id,
        title=room.title,
        has_password=bool(room.password_hash),
        is_member=is_member,
    )


@router.post("/join", response_model=RoomListItem)
def join_room(
    body: RoomJoinIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    norm = _normalize_invite_code(body.code)
    room = db.execute(select(Room).where(Room.invite_code == norm)).scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")

    if _user_has_room_access(db, user.id, room.id):
        return _room_list_item(room)

    if room.password_hash:
        pwd = (body.password or "").strip()
        if len(pwd) != 6 or not verify_password(pwd, room.password_hash):
            raise HTTPException(status_code=401, detail="Неверный пароль комнаты")

    db.execute(insert(user_rooms).values(user_id=user.id, room_id=room.id))
    db.commit()
    db.refresh(room)
    return _room_list_item(room)


@router.get("", response_model=list[RoomListItem])
def list_rooms(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = (
        select(Room)
        .join(user_rooms, Room.id == user_rooms.c.room_id)
        .where(user_rooms.c.user_id == user.id)
        .order_by(func.lower(func.coalesce(Room.title, "")).asc(), Room.id.asc())
    )
    rooms = db.scalars(q).all()
    return [_room_list_item(r) for r in rooms]


@router.post("", response_model=RoomCreatedOut)
def create_room(
    data: RoomCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.title and data.title.strip():
        title = data.title.strip()
    else:
        title = _default_room_title(db, user.id)
    desc = data.description.strip() if data.description and data.description.strip() else None

    pwd_hash = None
    if data.password and len(data.password.strip()) == 6:
        pwd_hash = hash_password(data.password.strip())

    invite = _generate_unique_invite_code(db)
    room = Room(
        title=title,
        description=desc,
        owner_id=user.id,
        next_file_index=2,
        invite_code=invite,
        password_hash=pwd_hash,
    )
    db.add(room)
    db.flush()

    db.execute(insert(user_rooms).values(user_id=user.id, room_id=room.id))

    first_id = uuid.uuid4().hex[:16]
    room.active_file_client_id = first_id
    f = RoomFile(room_id=room.id, client_id=first_id, name="Файл 1", content="", sort_order=0)
    db.add(f)
    db.commit()
    db.refresh(room)
    return RoomCreatedOut(
        id=room.id,
        title=room.title,
        description=room.description,
        owner_id=room.owner_id,
        invite_code=room.invite_code or invite,
        invite_link=_invite_link(request, room.invite_code or invite),
    )


@router.get("/{room_id}/settings", response_model=RoomSettingsOut)
def get_room_settings(
    room_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    code = room.invite_code or ""
    if not code:
        code = _generate_unique_invite_code(db)
        room.invite_code = code
        db.commit()
        db.refresh(room)
    members = _members_sorted(db, room)
    return RoomSettingsOut(
        title=room.title,
        description=room.description,
        invite_code=code,
        invite_link=_invite_link(request, code),
        has_password=bool(room.password_hash),
        members=[RoomMemberOut(id=u.id, username=u.username) for u in members],
    )


@router.get("/{room_id}", response_model=RoomOut)
def get_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    return _room_to_out(db, room)


@router.patch("/{room_id}/settings", response_model=RoomSettingsOut)
def patch_room_settings(
    room_id: int,
    data: RoomSettingsPatch,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)

    if data.title is not None:
        t = data.title.strip()
        if not t:
            room.title = _default_room_title(db, user.id, exclude_room_id=room.id)
        else:
            room.title = t

    if data.clear_password:
        if room.password_hash:
            old = (data.old_password or "").strip()
            if len(old) != 6 or not verify_password(old, room.password_hash):
                raise HTTPException(status_code=400, detail="Неверный текущий пароль комнаты")
        room.password_hash = None
    elif data.new_password:
        if room.password_hash:
            old = (data.old_password or "").strip()
            if len(old) != 6 or not verify_password(old, room.password_hash):
                raise HTTPException(status_code=400, detail="Неверный текущий пароль комнаты")
        room.password_hash = hash_password(data.new_password.strip())

    db.commit()
    db.refresh(room)
    return get_room_settings(room_id, request, user, db)


@router.post("/{room_id}/leave")
def leave_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    if room.owner_id == user.id:
        raise HTTPException(status_code=400, detail="Владелец не может покинуть комнату — удалите её")
    if not _user_has_room_access(db, user.id, room_id):
        raise HTTPException(status_code=403, detail="Нет доступа к комнате")
    db.execute(
        delete(user_rooms).where(
            user_rooms.c.user_id == user.id,
            user_rooms.c.room_id == room_id,
        )
    )
    db.commit()
    return {"ok": True}


@router.delete("/{room_id}/members/{member_id}")
def kick_member(
    room_id: int,
    member_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    if member_id == room.owner_id:
        raise HTTPException(status_code=400, detail="Нельзя исключить владельца")
    row = db.execute(
        select(user_rooms.c.user_id).where(
            user_rooms.c.room_id == room_id,
            user_rooms.c.user_id == member_id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Участник не найден в комнате")
    db.execute(
        delete(user_rooms).where(
            user_rooms.c.room_id == room_id,
            user_rooms.c.user_id == member_id,
        )
    )
    db.commit()
    return {"ok": True}


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
    return _room_list_item(room)


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
