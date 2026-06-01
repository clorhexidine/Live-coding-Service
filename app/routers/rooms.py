import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import decode_token, hash_password, verify_password
from app.database import SessionLocal, get_db
from app.deps import COOKIE_NAME, get_current_user
from app.invites import new_invite_code, new_invite_token
from app.models import Room, RoomComment, RoomFile, User, banned_members, user_rooms
from app.realtime_hub import hub
from app.schemas import (
    CommentOut,
    JoinPreviewOut,
    RoomCreate,
    RoomFileOut,
    RoomJoinIn,
    RoomListItem,
    RoomMemberOut,
    RoomOut,
    RoomSettingsOut,
    RoomSettingsPatch,
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


def _user_is_banned(db: Session, user_id: int, room_id: int) -> bool:
    row = db.execute(
        select(banned_members.c.room_id).where(
            banned_members.c.user_id == user_id,
            banned_members.c.room_id == room_id,
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


def _find_room_by_code(db: Session, code: str) -> Room | None:
    c = (code or "").strip().upper()
    if not c:
        return None
    return db.execute(select(Room).where(Room.invite_code == c)).scalar_one_or_none()


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


def _unique_invite_code(db: Session) -> str:
    used_rows = db.execute(select(Room.invite_code).where(Room.invite_code.isnot(None))).all()
    used = {r[0] for r in used_rows if r[0]}
    for _ in range(500):
        c = new_invite_code()
        if c not in used:
            return c
    return new_invite_code() + "X"


def _room_to_out(db: Session, room: Room, viewer: User | None = None) -> RoomOut:
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
    is_owner = viewer is not None and viewer.id == room.owner_id
    has_pw = bool(room.room_password_hash)
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
        is_owner=is_owner,
        has_room_password=has_pw,
    )


@router.get("/join-preview", response_model=JoinPreviewOut)
def join_preview_by_code(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _find_room_by_code(db, code)
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    is_banned = _user_is_banned(db, user.id, room.id)
    return JoinPreviewOut(
        room_id=room.id,
        title=room.title,
        has_room_password=bool(room.room_password_hash),
        already_member=_user_has_room_access(db, user.id, room.id),
        is_banned=is_banned,
    )


@router.get("/join-preview-token/{token}", response_model=JoinPreviewOut)
def join_preview_by_token(
    token: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # token здесь — это invite_code (6 символов), путь /join/{code}
    room = _find_room_by_code(db, token)
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    is_banned = _user_is_banned(db, user.id, room.id)
    return JoinPreviewOut(
        room_id=room.id,
        title=room.title,
        has_room_password=bool(room.room_password_hash),
        already_member=_user_has_room_access(db, user.id, room.id),
        is_banned=is_banned,
    )


@router.post("/join", response_model=dict)
def join_room(
    body: RoomJoinIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    code = (body.code or "").strip().upper() or None
    token = (body.invite_token or "").strip() or None
    if bool(code) == bool(token):
        raise HTTPException(status_code=400, detail="Укажите код или пригласительный токен")
    # Оба варианта теперь ищут по коду
    lookup_code = code or token or ""
    room = _find_room_by_code(db, lookup_code)
    if not room:
        raise HTTPException(status_code=404, detail="Комната не найдена")
    # Проверяем бан
    if _user_is_banned(db, user.id, room.id):
        raise HTTPException(status_code=403, detail="Вы были удалены из этой комнаты. Попросите владельца выслать новое приглашение.")
    if _user_has_room_access(db, user.id, room.id):
        return {"ok": True, "room_id": room.id, "already_member": True}
    if room.room_password_hash:
        pw = (body.password or "").strip()
        if not verify_password(pw, room.room_password_hash):
            raise HTTPException(status_code=401, detail="Неверный пароль комнаты")
    try:
        db.execute(insert(user_rooms).values(user_id=user.id, room_id=room.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "room_id": room.id, "already_member": True}
    return {"ok": True, "room_id": room.id, "already_member": False}


@router.get("/default-title", response_model=dict)
def get_default_room_title(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"title": _default_room_title(db, user.id)}


def _require_room_owner(room: Room, user: User) -> None:
    if room.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Только владелец может изменять или удалять комнату")


def _members_for_settings(db: Session, room: Room) -> list[RoomMemberOut]:
    users = db.scalars(
        select(User)
        .join(user_rooms, User.id == user_rooms.c.user_id)
        .where(user_rooms.c.room_id == room.id)
    ).all()
    owner_u = next((u for u in users if u.id == room.owner_id), None)
    if not owner_u:
        return []
    others = sorted((u for u in users if u.id != room.owner_id), key=lambda u: u.username.lower())
    out = [RoomMemberOut(id=owner_u.id, username=owner_u.username, is_owner=True)]
    out.extend(RoomMemberOut(id=u.id, username=u.username, is_owner=False) for u in others)
    return out


def _banned_for_settings(db: Session, room: Room) -> list[RoomMemberOut]:
    users = db.scalars(
        select(User)
        .join(banned_members, User.id == banned_members.c.user_id)
        .where(banned_members.c.room_id == room.id)
    ).all()
    return sorted(
        [RoomMemberOut(id=u.id, username=u.username, is_owner=False, is_banned=True) for u in users],
        key=lambda m: m.username.lower(),
    )


@router.get("/{room_id}/settings", response_model=RoomSettingsOut)
def get_room_settings(
    room_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    if not room.invite_code:
        room.invite_code = _unique_invite_code(db)
        db.commit()
        db.refresh(room)
    return RoomSettingsOut(
        title=room.title,
        invite_code=room.invite_code or "",
        has_room_password=bool(room.room_password_hash),
        members=_members_for_settings(db, room),
        banned_members=_banned_for_settings(db, room),
    )


@router.patch("/{room_id}/settings", response_model=RoomSettingsOut)
def patch_room_settings(
    room_id: int,
    data: RoomSettingsPatch,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_client_tab_id: str | None = Header(default=None, alias="X-Client-Tab-Id"),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    if data.title is not None:
        room.title = data.title.strip()
    oldp = (data.old_room_password or "").strip()
    np = (data.new_room_password or "").strip()
    nc = (data.new_room_password_confirm or "").strip()

    if data.clear_room_password:
        if room.room_password_hash:
            if not verify_password(oldp, room.room_password_hash):
                raise HTTPException(status_code=401, detail="Неверный текущий пароль комнаты")
            room.room_password_hash = None
    elif np or nc:
        if len(np) != 6 or np != nc:
            raise HTTPException(
                status_code=400,
                detail="Новый пароль — ровно 6 символов и должен совпадать с подтверждением",
            )
        if room.room_password_hash and not verify_password(oldp, room.room_password_hash):
            raise HTTPException(status_code=401, detail="Неверный текущий пароль комнаты")
        room.room_password_hash = hash_password(np)

    db.commit()
    db.refresh(room)
    if not room.invite_code:
        room.invite_code = _unique_invite_code(db)
        db.commit()
        db.refresh(room)
    out = RoomSettingsOut(
        title=room.title,
        invite_code=room.invite_code or "",
        has_room_password=bool(room.room_password_hash),
        members=_members_for_settings(db, room),
        banned_members=_banned_for_settings(db, room),
    )
    if data.title is not None:
        seq = hub.next_seq(room_id)
        background_tasks.add_task(
            hub.broadcast_json,
            room_id,
            {
                "type": "room_meta",
                "title": room.title,
                "description": room.description,
                "seq": seq,
                "sender_tab_id": (x_client_tab_id or "")[:80],
            },
        )
    return out


@router.post("/{room_id}/reinvite/{member_user_id}", response_model=RoomSettingsOut)
def reinvite_banned_member(
    room_id: int,
    member_user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Снять бан и выдать новый код приглашения (старый код становится недействительным для этого пользователя)."""
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    # Снимаем бан
    db.execute(
        delete(banned_members).where(
            banned_members.c.user_id == member_user_id,
            banned_members.c.room_id == room_id,
        )
    )
    # Генерируем новый код приглашения для комнаты
    room.invite_code = _unique_invite_code(db)
    db.commit()
    db.refresh(room)
    return RoomSettingsOut(
        title=room.title,
        invite_code=room.invite_code or "",
        has_room_password=bool(room.room_password_hash),
        members=_members_for_settings(db, room),
        banned_members=_banned_for_settings(db, room),
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
    pw = (data.password or "").strip() if data.password else ""
    pc = (data.password_confirm or "").strip() if data.password_confirm else ""
    if pw or pc:
        if len(pw) != 6 or pw != pc:
            raise HTTPException(
                status_code=400,
                detail="Пароль комнаты — ровно 6 символов и должен совпадать с подтверждением",
            )
    if data.title and data.title.strip():
        title = data.title.strip()
    else:
        title = _default_room_title(db, user.id)
    desc = data.description.strip() if data.description and data.description.strip() else None
    room = Room(
        title=title,
        description=desc,
        owner_id=user.id,
        next_file_index=2,
        invite_token=new_invite_token(),
        invite_code=_unique_invite_code(db),
        room_password_hash=hash_password(pw) if pw else None,
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
    return room


def _apply_room_state_to_db(db: Session, room: Room, body: RoomStateIn) -> None:
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


@router.get("/{room_id}", response_model=RoomOut)
def get_room(
    room_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    return _room_to_out(db, room, user)


@router.put("/{room_id}/state", response_model=RoomOut)
def save_room_state(
    room_id: int,
    body: RoomStateIn,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_client_tab_id: str | None = Header(default=None, alias="X-Client-Tab-Id"),
):
    room = _get_room_or_403(db, user, room_id)
    _apply_room_state_to_db(db, room, body)
    out = _room_to_out(db, room, None)
    seq = hub.next_seq(room_id)
    payload = {
        "type": "state",
        "room": out.model_dump(mode="json"),
        "seq": seq,
        "sender_tab_id": (x_client_tab_id or "")[:80],
    }
    background_tasks.add_task(hub.broadcast_json, room_id, payload)
    return out


@router.patch("/{room_id}", response_model=RoomListItem)
def update_room(
    room_id: int,
    data: RoomUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_client_tab_id: str | None = Header(default=None, alias="X-Client-Tab-Id"),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    if data.title is not None:
        room.title = data.title.strip()
    if data.description is not None:
        room.description = data.description
    db.commit()
    db.refresh(room)
    patch_fields = data.model_dump(exclude_unset=True)
    if patch_fields:
        seq = hub.next_seq(room_id)
        background_tasks.add_task(
            hub.broadcast_json,
            room_id,
            {
                "type": "room_meta",
                "title": room.title,
                "description": room.description,
                "seq": seq,
                "sender_tab_id": (x_client_tab_id or "")[:80],
            },
        )
    return room


@router.delete("/{room_id}")
def delete_room(
    room_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    rid = room.id
    db.delete(room)
    db.commit()
    background_tasks.add_task(hub.broadcast_json, rid, {"type": "room_deleted", "seq": hub.next_seq(rid)})
    return {"ok": True}


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
        raise HTTPException(
            status_code=400,
            detail="Владелец не может покинуть комнату так — удалите комнату или оставайтесь в списке.",
        )
    if not _user_has_room_access(db, user.id, room_id):
        raise HTTPException(status_code=403, detail="Нет доступа к комнате")
    db.execute(delete(user_rooms).where(user_rooms.c.user_id == user.id, user_rooms.c.room_id == room_id))
    db.commit()
    return {"ok": True}


@router.delete("/{room_id}/members/{member_user_id}")
def remove_room_member(
    room_id: int,
    member_user_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_403(db, user, room_id)
    _require_room_owner(room, user)
    if member_user_id == room.owner_id:
        raise HTTPException(status_code=400, detail="Нельзя удалить владельца")
    if member_user_id == user.id:
        raise HTTPException(status_code=400, detail="Используйте «Покинуть комнату»")
    res = db.execute(
        delete(user_rooms).where(
            user_rooms.c.user_id == member_user_id,
            user_rooms.c.room_id == room_id,
        )
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Участник не найден в комнате")
    # Добавляем в бан-лист
    try:
        db.execute(insert(banned_members).values(user_id=member_user_id, room_id=room_id))
    except Exception:
        pass  # уже забанен
    db.commit()
    background_tasks.add_task(
        hub.send_to_user_in_room,
        room_id,
        member_user_id,
        {"type": "access_lost"},
    )
    return {"ok": True}


@router.websocket("/{room_id}/ws")
async def room_websocket(websocket: WebSocket, room_id: int):
    await websocket.accept()
    token = websocket.cookies.get(COOKIE_NAME)
    if not token:
        await websocket.close(code=4401)
        return
    user_id = decode_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            await websocket.close(code=4401)
            return
        room_inst = db.get(Room, room_id)
        if not room_inst or not _user_has_room_access(db, user.id, room_id):
            await websocket.close(code=4403)
            return
    finally:
        db.close()

    websocket.state.user_id = user.id
    websocket.state.room_id = room_id
    await hub.add(room_id, websocket)

    try:
        while True:
            raw = await websocket.receive_json()
            t = raw.get("type")
            if t == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if t == "op":
                tab_id = str(raw.get("tab_id") or "")[:80]
                websocket.state.tab_id = tab_id
                file_id = str(raw.get("file_id") or "")[:64]
                pos = raw.get("pos")
                remove = raw.get("remove")
                insert_text = raw.get("insert")
                if (
                    file_id
                    and isinstance(pos, int) and pos >= 0
                    and isinstance(remove, int) and remove >= 0
                    and isinstance(insert_text, str) and len(insert_text) <= 200000
                ):
                    await hub.broadcast_json_except(
                        room_id,
                        {
                            "type": "op",
                            "tab_id": tab_id,
                            "file_id": file_id,
                            "pos": pos,
                            "remove": remove,
                            "insert": insert_text,
                        },
                        websocket,
                    )
                continue

            if t == "cursor":
                tab_id = str(raw.get("tab_id") or "")[:80]
                websocket.state.tab_id = tab_id
                file_id = str(raw.get("file_id") or "")[:64]
                pos = raw.get("pos")
                username = str(raw.get("username") or "")[:64]
                if file_id and isinstance(pos, int) and pos >= 0:
                    await hub.broadcast_json_except(
                        room_id,
                        {
                            "type": "cursor",
                            "tab_id": tab_id,
                            "file_id": file_id,
                            "pos": pos,
                            "username": username,
                        },
                        websocket,
                    )
                continue

            if t != "state":
                continue
            tab_id = str(raw.get("tab_id") or "")[:80]
            payload = raw.get("payload")
            if not isinstance(payload, dict):
                continue
            try:
                body = RoomStateIn.model_validate(payload)
            except Exception:
                await websocket.send_json({"type": "error", "detail": "invalid_payload"})
                continue

            db = SessionLocal()
            try:
                room_inst = db.get(Room, room_id)
                if not room_inst:
                    await websocket.send_json({"type": "room_deleted"})
                    break
                if not _user_has_room_access(db, user.id, room_id):
                    await websocket.send_json({"type": "access_lost"})
                    break
                _apply_room_state_to_db(db, room_inst, body)
                out = _room_to_out(db, room_inst, None)
            except HTTPException as he:
                db.rollback()
                await websocket.send_json({"type": "error", "detail": str(he.detail)})
                continue
            finally:
                db.close()

            seq = hub.next_seq(room_id)
            await hub.broadcast_json(
                room_id,
                {
                    "type": "state",
                    "room": out.model_dump(mode="json"),
                    "seq": seq,
                    "sender_tab_id": tab_id,
                },
            )
    except WebSocketDisconnect:
        pass
    finally:
        await hub.broadcast_json_except(
            room_id,
            {"type": "cursor_leave", "tab_id": getattr(websocket.state, "tab_id", "")},
            websocket,
        )
        await hub.remove(room_id, websocket)
