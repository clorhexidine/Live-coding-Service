from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, Table, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base

user_rooms = Table(
    "user_rooms",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("room_id", Integer, ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True),
    Column("joined_at", DateTime, default=datetime.utcnow),
)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    rooms_owned = relationship("Room", back_populates="owner")
    rooms = relationship("Room", secondary=user_rooms, back_populates="members")


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    invite_code = Column(String(8), nullable=True, unique=True, index=True)
    password_hash = Column(String(255), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    active_file_client_id = Column(String(64), nullable=True)
    next_file_index = Column(Integer, default=2, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="rooms_owned")
    members = relationship("User", secondary=user_rooms, back_populates="rooms")
    files = relationship("RoomFile", back_populates="room", cascade="all, delete-orphan")
    comments = relationship("RoomComment", back_populates="room", cascade="all, delete-orphan")


class RoomComment(Base):
    __tablename__ = "room_comments"
    __table_args__ = (UniqueConstraint("room_id", "client_comment_id", name="uq_room_comment_client"),)

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    file_client_id = Column(String(64), nullable=False)
    client_comment_id = Column(String(64), nullable=False)
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    body = Column(Text, nullable=False)

    room = relationship("Room", back_populates="comments")


class RoomFile(Base):
    __tablename__ = "room_files"
    __table_args__ = (UniqueConstraint("room_id", "client_id", name="uq_room_file_client"),)

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    client_id = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    content = Column(Text, default="", nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)

    room = relationship("Room", back_populates="files")
