"""In-memory WebSocket fan-out по комнатам (один процесс uvicorn)."""

from __future__ import annotations

import asyncio
from collections import defaultdict

from starlette.websockets import WebSocket


class RoomHub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._conns: dict[int, list[WebSocket]] = defaultdict(list)
        self._seq: dict[int, int] = defaultdict(int)

    def next_seq(self, room_id: int) -> int:
        self._seq[room_id] += 1
        return self._seq[room_id]

    def current_seq(self, room_id: int) -> int:
        return int(self._seq.get(room_id, 0))

    async def add(self, room_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[room_id].append(ws)

    async def remove(self, room_id: int, ws: WebSocket) -> None:
        async with self._lock:
            lst = self._conns.get(room_id)
            if not lst:
                return
            if ws in lst:
                lst.remove(ws)
            if not lst:
                del self._conns[room_id]

    async def broadcast_json(self, room_id: int, message: dict) -> None:
        async with self._lock:
            targets = list(self._conns.get(room_id, []))
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                try:
                    await self.remove(room_id, ws)
                except Exception:
                    pass

    async def broadcast_json_except(self, room_id: int, message: dict, exclude_ws: WebSocket) -> None:
        """Рассылает сообщение всем кроме указанного соединения."""
        async with self._lock:
            targets = list(self._conns.get(room_id, []))
        for ws in targets:
            if ws is exclude_ws:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                try:
                    await self.remove(room_id, ws)
                except Exception:
                    pass

    async def send_to_user_in_room(self, room_id: int, user_id: int, message: dict) -> None:
        async with self._lock:
            targets = list(self._conns.get(room_id, []))
        for ws in targets:
            if getattr(ws.state, "user_id", None) != user_id:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                pass
            try:
                await ws.close(code=4403)
            except Exception:
                pass
            await self.remove(room_id, ws)


hub = RoomHub()
