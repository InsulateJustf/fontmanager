"""Font file parser using fontTools.

Extracts metadata (family name, style name, format) from TTF, OTF, and TTC files.
"""

import os
import re
from typing import Optional
from fontTools.ttLib import TTFont


# Supported extensions
SUPPORTED_EXTENSIONS = {".ttf", ".otf", ".ttc"}


def detect_format(filepath: str) -> Optional[str]:
    """Detect font format from file extension."""
    ext = os.path.splitext(filepath)[1].lower()
    if ext in SUPPORTED_EXTENSIONS:
        return ext.lstrip(".")
    return None


def _sanitize_filename(name: str) -> str:
    """Replace illegal filename characters with underscore."""
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def parse_font(filepath: str) -> dict:
    """Parse a font file and return metadata.

    Returns dict with keys:
        family_name, style_name, format, version, full_name

    Raises ValueError if the file cannot be parsed.
    """
    fmt = detect_format(filepath)
    if fmt is None:
        raise ValueError(f"Unsupported file format: {os.path.splitext(filepath)[1]}")

    try:
        font = TTFont(filepath, fontNumber=0)
    except Exception as e:
        raise ValueError(f"Failed to parse font file: {e}") from e

    try:
        name_table = font.get("name")
        if name_table is None:
            raise ValueError("Font has no name table")

        family_name = name_table.getDebugName(1) or name_table.getDebugName(16)
        style_name = name_table.getDebugName(2) or name_table.getDebugName(17)
        version = name_table.getDebugName(5) or ""
        full_name = name_table.getDebugName(4) or ""

        if not family_name:
            # Fallback: try to extract from full name
            if full_name:
                parts = full_name.split()
                family_name = parts[0] if parts else "Unknown"
            else:
                family_name = "Unknown"

        if not style_name:
            style_name = "Regular"

        return {
            "family_name": family_name.strip(),
            "style_name": style_name.strip(),
            "format": fmt,
            "version": version.strip(),
            "full_name": full_name.strip(),
        }
    finally:
        font.close()


def generate_filename(family_name: str, style_name: str, ext: str) -> str:
    """Generate a sanitized filename from font metadata."""
    safe_family = _sanitize_filename(family_name)
    safe_style = _sanitize_filename(style_name)
    return f"{safe_family}-{safe_style}.{ext}"
