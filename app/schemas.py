from pydantic import BaseModel, Field, model_validator


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}


class RoomFileIn(BaseModel):
    id: str = Field(..., max_length=64)
    name: str = Field(..., max_length=255)
    content: str = ""


class CommentIn(BaseModel):
    id: str = Field(..., max_length=64)
    file_id: str = Field(..., max_length=64)
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    body: str = Field(..., max_length=8000)

    @model_validator(mode="after")
    def check_range(self):
        if self.end < self.start:
            raise ValueError("end < start")
        return self


class RoomStateIn(BaseModel):
    files: list[RoomFileIn]
    active_file_id: str | None = None
    next_file_index: int = Field(ge=2, le=10000)
    comments: list[CommentIn] = Field(default_factory=list)


class RoomFileOut(BaseModel):
    id: str
    name: str
    content: str


class CommentOut(BaseModel):
    id: str
    file_id: str
    start: int
    end: int
    body: str


class RoomOut(BaseModel):
    id: int
    title: str | None
    description: str | None
    owner_id: int
    files: list[RoomFileOut]
    active_file_id: str | None
    next_file_index: int
    comments: list[CommentOut]
    is_owner: bool = False
    has_room_password: bool = False


class RoomCreate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=16000)
    password: str | None = None
    password_confirm: str | None = None


class RoomUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=16000)


class RoomListItem(BaseModel):
    id: int
    title: str | None
    description: str | None
    owner_id: int

    model_config = {"from_attributes": True}


class JoinPreviewOut(BaseModel):
    room_id: int
    title: str | None
    has_room_password: bool
    already_member: bool = False
    is_banned: bool = False


class RoomJoinIn(BaseModel):
    code: str | None = None
    invite_token: str | None = None
    password: str | None = Field(None, max_length=32)


class RoomMemberOut(BaseModel):
    id: int
    username: str
    is_owner: bool
    is_banned: bool = False


class RoomSettingsOut(BaseModel):
    title: str | None
    invite_code: str
    has_room_password: bool
    members: list[RoomMemberOut]
    banned_members: list[RoomMemberOut] = Field(default_factory=list)


class RoomSettingsPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    old_room_password: str | None = None
    new_room_password: str | None = None
    new_room_password_confirm: str | None = None
    clear_room_password: bool = False
