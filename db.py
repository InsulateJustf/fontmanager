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


def _table_exists(cursor, table_name):
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table_name,))
    return cursor.fetchone() is not None


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
    # Migrate: add columns if table already existed
    if _table_exists(cursor, "fonts"):
        existing = {row[1] for row in cursor.execute("PRAGMA table_info(fonts)").fetchall()}
        if "cjk_info" not in existing:
            cursor.execute("ALTER TABLE fonts ADD COLUMN cjk_info TEXT")
        if "subfonts_info" not in existing:
            cursor.execute("ALTER TABLE fonts ADD COLUMN subfonts_info TEXT")
        if "cmap_fingerprint" not in existing:
            cursor.execute("ALTER TABLE fonts ADD COLUMN cmap_fingerprint TEXT")
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


def get_font_by_family_style(family_name: str, style_name: str) -> Optional[dict]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM fonts WHERE LOWER(family_name)=LOWER(?) AND LOWER(style_name)=LOWER(?)",
        (family_name.strip(), style_name.strip()),
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def insert_font(family_name, style_name, fmt, file_size, file_hash,
                stored_filename, original_filename, cjk_info=None, subfonts_info=None,
                cmap_fingerprint=None) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO fonts
           (family_name, style_name, format, file_size, file_hash,
            stored_filename, original_filename, cjk_info, subfonts_info,
            cmap_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (family_name, style_name, fmt, file_size, file_hash,
         stored_filename, original_filename,
         json.dumps(cjk_info, ensure_ascii=False) if cjk_info else None,
         json.dumps(subfonts_info, ensure_ascii=False) if subfonts_info else None,
         json.dumps(cmap_fingerprint, ensure_ascii=False) if cmap_fingerprint else None),
    )
    font_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return font_id


def replace_font(font_id, family_name, style_name, fmt, file_size, file_hash,
                 stored_filename, original_filename, cjk_info=None, subfonts_info=None):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """UPDATE fonts SET
           family_name=?, style_name=?, format=?, file_size=?, file_hash=?,
           stored_filename=?, original_filename=?, cjk_info=?, subfonts_info=?
           WHERE id=?""",
        (family_name, style_name, fmt, file_size, file_hash,
         stored_filename, original_filename,
         json.dumps(cjk_info, ensure_ascii=False) if cjk_info else None,
         json.dumps(subfonts_info, ensure_ascii=False) if subfonts_info else None,
         font_id),
    )
    conn.commit()
    conn.close()


def get_all_fonts() -> list:
    conn = get_connection()
    cursor = conn.cursor()
    # Auto-create table if missing (recovery from corrupted/old DB)
    if not _table_exists(cursor, "fonts"):
        conn.close()
        init_db()
        conn = get_connection()
        cursor = conn.cursor()
    cursor.execute("SELECT * FROM fonts ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_fonts_by_family(family_name: str) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fonts WHERE family_name=? ORDER BY style_name", (family_name,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_fonts_by_fingerprint(fingerprint_hash: str) -> list:
    """Find fonts with matching cmap fingerprint hash (for TTF/OTF only)."""
    conn = get_connection()
    cursor = conn.cursor()
    # cmap_fingerprint is stored as JSON; match on the hash field
    cursor.execute(
        "SELECT * FROM fonts WHERE cmap_fingerprint LIKE ?",
        ('%"hash": "{}"%'.format(fingerprint_hash),),
    )
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


# ─── Tags ─────────────────────────────────────────────────────────────────────

def init_tags_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            color TEXT DEFAULT '#6b7280',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS font_tags (
            font_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (font_id, tag_id),
            FOREIGN KEY (font_id) REFERENCES fonts(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


def get_all_tags():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT t.id, t.name, t.color, COUNT(ft.font_id) as count
        FROM tags t
        LEFT JOIN font_tags ft ON t.id = ft.tag_id
        GROUP BY t.id
        ORDER BY t.name
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def create_tag(name, color='#6b7280'):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO tags (name, color) VALUES (?, ?)", (name, color))
    tag_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return tag_id


def delete_tag(tag_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM font_tags WHERE tag_id=?", (tag_id,))
    cursor.execute("DELETE FROM tags WHERE id=?", (tag_id,))
    conn.commit()
    conn.close()


def add_font_tag(font_id, tag_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO font_tags (font_id, tag_id) VALUES (?, ?)", (font_id, tag_id))
    conn.commit()
    conn.close()


def remove_font_tag(font_id, tag_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM font_tags WHERE font_id=? AND tag_id=?", (font_id, tag_id))
    conn.commit()
    conn.close()


def get_font_tags(font_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT t.id, t.name, t.color
        FROM tags t
        JOIN font_tags ft ON t.id = ft.tag_id
        WHERE ft.font_id = ?
    """, (font_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]
