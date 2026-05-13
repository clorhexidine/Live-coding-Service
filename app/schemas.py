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


class RoomCreate(BaseModel):
    title: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=16000)


class RoomUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=16000)


class RoomListItem(BaseModel):
    id: int
    title: str | None
    description: str | None

    model_config = {"from_attributes": True}
