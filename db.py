"""SQLite database operations for font metadata."""

import json
import os
import sqlite3
import hashlib
from typing import Optional
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fontmanager.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fonts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            family_name TEXT NOT NULL,
            style_name TEXT NOT NULL,
            format TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_hash TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            cjk_info TEXT,
            subfonts_info TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(family_name, style_name)
        )
    """)
    # Migrate: add columns if missing
    existing = {row[1] for row in cursor.execute("PRAGMA table_info(fonts)").fetchall()}
    if "cjk_info" not in existing:
        cursor.execute("ALTER TABLE fonts ADD COLUMN cjk_info TEXT")
    if "subfonts_info" not in existing:
        cursor.execute("ALTER TABLE fonts ADD COLUMN subfonts_info TEXT")
    conn.commit()
    conn.close()


def compute_file_hash(filepath: str) -> str:
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def font_exists(family_name: str, style_name: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM fonts WHERE LOWER(family_name)=LOWER(?) AND LOWER(style_name)=LOWER(?)",
        (family_name.strip(), style_name.strip()),
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count > 0


def insert_font(family_name, style_name, fmt, file_size, file_hash,
                stored_filename, original_filename, cjk_info=None, subfonts_info=None) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO fonts
           (family_name, style_name, format, file_size, file_hash,
            stored_filename, original_filename, cjk_info, subfonts_info)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (family_name, style_name, fmt, file_size, file_hash,
         stored_filename, original_filename,
         json.dumps(cjk_info, ensure_ascii=False) if cjk_info else None,
         json.dumps(subfonts_info, ensure_ascii=False) if subfonts_info else None),
    )
    font_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return font_id


def get_all_fonts() -> list:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fonts ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_font_by_id(font_id: int) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fonts WHERE id=?", (font_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def delete_font(font_id: int) -> Optional[dict]:
    font = get_font_by_id(font_id)
    if font:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM fonts WHERE id=?", (font_id,))
        conn.commit()
        conn.close()
    return font
