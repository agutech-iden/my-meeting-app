import os
import secrets
import sqlite3
from aiohttp import web
from livekit import api

# =========================
# LIVEKIT CREDENTIALS
# =========================
# Use your actual LiveKit credentials here

# =========================
# ENVIRONMENT VARIABLES
# (Set these on Render)
# =========================
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

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
    try:
        data = await request.json()
        room_name = data.get("room")
        user_name = data.get("user")
        is_host = data.get("isHost", False)

        if not room_name or not user_name:
            return web.json_response({"error": "Missing room or user"}, status=400)

        # In the get_token_handler function, update the video_grants:
        video_grants = api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            room_admin=is_host,  # Give host admin privileges
            can_publish_data=True,
            can_publish_sources=["camera", "microphone", "screen_share"],
            hidden=False,
            recorder=False  # Only host can record
        )

        token = (
            api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
            .with_identity(user_name)
            .with_grants(video_grants)
            .to_jwt()
        )

        return web.json_response({"token": token})

    except Exception as e:
        return web.json_response({"error": f"Token generation failed: {str(e)}"}, status=500)


async def create_meeting(request):
    data = await request.json()
    title = data.get("title", "")

    if not title:
        return web.json_response({"error": "Meeting title is required"}, status=400)

    code = secrets.token_hex(4).upper()

    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            "INSERT INTO meetings (code, title, start_time, end_time) VALUES (?, ?, ?, ?)",
            (code, title, data.get("start", ""), data.get("end", ""))
        )
        conn.commit()
    except sqlite3.IntegrityError:
        # If code already exists, generate a new one
        code = secrets.token_hex(4).upper()
        conn.execute(
            "INSERT INTO meetings (code, title, start_time, end_time) VALUES (?, ?, ?, ?)",
            (code, title, data.get("start", ""), data.get("end", ""))
        )
        conn.commit()
    finally:
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

