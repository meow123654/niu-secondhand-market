"""Local Flask + SQLite server for the NIU campus marketplace demo."""
from __future__ import annotations

import mimetypes
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UPLOADS = ROOT / "uploads"
DATA.mkdir(exist_ok=True)
UPLOADS.mkdir(exist_ok=True)
DB_PATH = DATA / "marketplace.sqlite3"
app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 80 * 1024 * 1024


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, price INTEGER NOT NULL,
            category TEXT NOT NULL, condition TEXT NOT NULL, seller TEXT NOT NULL,
            contact TEXT NOT NULL, location TEXT, description TEXT, image TEXT,
            emoji TEXT, status TEXT NOT NULL DEFAULT 'available', createdAt INTEGER NOT NULL,
            department TEXT DEFAULT '', ownerId TEXT DEFAULT '', mediaType TEXT DEFAULT '')""")
        cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
        for name in ("department", "ownerId", "mediaType"):
            if name not in cols:
                conn.execute(f"ALTER TABLE products ADD COLUMN {name} TEXT DEFAULT ''")
        conn.execute("""CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sender_id TEXT NOT NULL,
            sender_name TEXT NOT NULL, sender_department TEXT DEFAULT '', body TEXT DEFAULT '',
            media_url TEXT DEFAULT '', media_type TEXT DEFAULT '', created_at TEXT NOT NULL)""")


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/api/products")
def get_products():
    with db() as conn:
        rows = conn.execute("SELECT * FROM products ORDER BY createdAt DESC").fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/products")
def upsert_product():
    item = request.get_json(force=True)
    required = ("id", "title", "price", "category", "condition", "seller", "contact")
    if any(not item.get(key) for key in required):
        return jsonify(error="商品資料不完整"), 400
    fields = ("id", "title", "price", "category", "condition", "seller", "contact", "location", "description", "image", "emoji", "status", "createdAt", "department", "ownerId", "mediaType")
    values = [item.get(key, "") for key in fields]
    columns = ",".join(fields)
    updates = ",".join(f"{key}=excluded.{key}" for key in fields[1:])
    with db() as conn:
        conn.execute(f"INSERT INTO products ({columns}) VALUES ({','.join('?' for _ in fields)}) ON CONFLICT(id) DO UPDATE SET {updates}", values)
    return jsonify(ok=True)


@app.delete("/api/products/<product_id>")
def delete_product(product_id):
    with db() as conn:
        conn.execute("DELETE FROM products WHERE id=?", (product_id,))
        conn.execute("DELETE FROM messages WHERE product_id=?", (product_id,))
    return jsonify(ok=True)


@app.get("/api/chats/<product_id>")
def get_chat(product_id):
    with db() as conn:
        rows = conn.execute("SELECT * FROM messages WHERE product_id=? ORDER BY created_at", (product_id,)).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/chats/<product_id>")
def post_chat(product_id):
    body = request.get_json(force=True)
    message = str(body.get("body", "")).strip()
    media_url = str(body.get("media_url", ""))
    if not message and not media_url:
        return jsonify(error="請輸入訊息或選擇媒體"), 400
    item = {"id": uuid.uuid4().hex, "product_id": product_id,
            "sender_id": str(body.get("sender_id", "")),
            "sender_name": str(body.get("sender_name", "訪客"))[:30],
            "sender_department": str(body.get("sender_department", ""))[:60],
            "body": message[:2000], "media_url": media_url,
            "media_type": str(body.get("media_type", "")),
            "created_at": datetime.now(timezone.utc).isoformat()}
    with db() as conn:
        if not conn.execute("SELECT 1 FROM products WHERE id=?", (product_id,)).fetchone():
            return jsonify(error="商品不存在"), 404
        conn.execute("INSERT INTO messages VALUES (:id,:product_id,:sender_id,:sender_name,:sender_department,:body,:media_url,:media_type,:created_at)", item)
    return jsonify(item), 201


@app.get("/api/inbox")
def inbox():
    user_id = request.args.get("user_id", "")
    with db() as conn:
        rows = conn.execute("""SELECT p.id, p.title, p.seller, p.department, p.image,
            p.mediaType, MAX(m.created_at) AS last_message,
            (SELECT body FROM messages WHERE product_id=p.id ORDER BY created_at DESC LIMIT 1) AS last_text
            FROM messages m JOIN products p ON p.id=m.product_id
            WHERE m.sender_id=? OR p.ownerId=?
            GROUP BY p.id ORDER BY last_message DESC""", (user_id, user_id)).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/upload")
def upload_media():
    media = request.files.get("file")
    if not media or not media.filename:
        return jsonify(error="沒有選擇檔案"), 400
    mime = media.mimetype or "application/octet-stream"
    allowed_mime = {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"}
    if mime not in allowed_mime:
        return jsonify(error="僅支援照片或影片"), 415
    suffix = mimetypes.guess_extension(mime) or Path(secure_filename(media.filename)).suffix[:12]
    filename = f"{uuid.uuid4().hex}{suffix}"
    media.save(UPLOADS / filename)
    return jsonify(url=f"/uploads/{filename}", media_type="video" if mime.startswith("video/") else "image")


@app.get("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOADS, filename)


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error="檔案超過 80 MB，請先壓縮後再上傳"), 413


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), debug=False)
