"""SQLite database operations for font metadata."""

import os
import sqlite3
import hashlib
from typing import Optional
from datetime import datetime


DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fontmanager.db")


def get_connection():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize the database schema."""
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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(family_name, style_name)
        )
    """)
    conn.commit()
    conn.close()


def compute_file_hash(filepath: str) -> str:
    """Compute SHA256 hash of a file."""
    sha256 = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def font_exists(family_name: str, style_name: str) -> bool:
    """Check if a font with the given family+style already exists."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM fonts WHERE LOWER(family_name)=LOWER(?) AND LOWER(style_name)=LOWER(?)",
        (family_name.strip(), style_name.strip()),
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count > 0


def insert_font(
    family_name: str,
    style_name: str,
    fmt: str,
    file_size: int,
    file_hash: str,
    stored_filename: str,
    original_filename: str,
) -> int:
    """Insert a new font record and return its ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """INSERT INTO fonts (family_name, style_name, format, file_size, file_hash, stored_filename, original_filename)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (family_name, style_name, fmt, file_size, file_hash, stored_filename, original_filename),
    )
    font_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return font_id


def get_all_fonts() -> list:
    """Get all font records ordered by creation date."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fonts ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_font_by_id(font_id: int) -> Optional[dict]:
    """Get a font record by ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fonts WHERE id=?", (font_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def delete_font(font_id: int) -> Optional[dict]:
    """Delete a font record and return it."""
    font = get_font_by_id(font_id)
    if font:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM fonts WHERE id=?", (font_id,))
        conn.commit()
        conn.close()
    return font
