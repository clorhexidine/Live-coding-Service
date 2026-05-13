import secrets

# Без похожих символов 0/O, 1/I/L
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_invite_token() -> str:
    return secrets.token_urlsafe(32)[:64]


def new_invite_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
