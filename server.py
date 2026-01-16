import os
import secrets
import sqlite3
from aiohttp import web
from livekit import api

# =========================
# ENVIRONMENT VARIABLES
# (Set these on Render)
# =========================
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

# Render provides PORT automatically
PORT = int(os.getenv("PORT", "8888"))

STATIC_DIR = "static"
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)
DB_FILE = os.path.join(DATA_DIR, "database.db")


def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE,
            title TEXT,
            start_time TEXT,
            end_time TEXT
        )
        """
    )
    conn.commit()
    conn.close()


init_db()


async def get_token_handler(request):
    # If env vars are missing, fail clearly (helps beginners a lot)
    if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        return web.json_response(
            {"error": "Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET in environment variables"},
            status=500
        )

    data = await request.json()
    room_name = data.get("room")
    user_name = data.get("user")

    if not room_name or not user_name:
        return web.json_response({"error": "Missing room or user"}, status=400)

    video_grants = api.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True
    )

    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(user_name)
        .with_grants(video_grants)
        .to_jwt()
    )

    return web.json_response({"token": token})


async def create_meeting(request):
    data = await request.json()
    title = data.get("title", "")

    if not title:
        return web.json_response({"error": "Meeting title is required"}, status=400)

    code = secrets.token_hex(4).upper()

    conn = sqlite3.connect(DB_FILE)
    conn.execute(
        "INSERT INTO meetings (code, title, start_time, end_time) VALUES (?, ?, ?, ?)",
        (code, title, data.get("start", ""), data.get("end", ""))
    )
    conn.commit()
    conn.close()

    return web.json_response({"status": "success", "code": code})


def index(request):
    return web.FileResponse(os.path.join(STATIC_DIR, "index.html"))


app = web.Application()
app.add_routes([
    web.get("/", index),
    web.post("/get_token", get_token_handler),
    web.post("/create_meeting", create_meeting),
    web.static("/static", STATIC_DIR)
])


if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=PORT)
