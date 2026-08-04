"""Font file parser using fontTools.

Extracts metadata (family name, style name, format) from TTF, OTF, and TTC files.
- Family name: prefers Chinese when available
- Style name: prefers English (Regular/Bold/Italic are standard)
"""

import os
import re
from typing import Optional
from fontTools.ttLib import TTFont

SUPPORTED_EXTENSIONS = {".ttf", ".otf", ".ttc"}


def detect_format(filepath: str) -> Optional[str]:
    ext = os.path.splitext(filepath)[1].lower()
    if ext in SUPPORTED_EXTENSIONS:
        return ext.lstrip(".")
    return None


def _sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def _get_name(name_table, name_id: int, prefer_chinese: bool = True) -> Optional[str]:
    """Get a name record with configurable language priority.

    prefer_chinese=True  → used for family/full names (方正新秀丽繁体)
    prefer_chinese=False → used for style names (Regular, not 常规体)
    """
    CN_PRIORITY = [
        (3, 2052),  # Windows Simplified Chinese
        (3, 1028),  # Windows Traditional Chinese
        (1, 33),    # Mac Chinese
        (3, 1033),  # Windows English US
        (1, 0),     # Mac English
    ]
    EN_PRIORITY = [
        (3, 1033),  # Windows English US
        (1, 0),     # Mac English
        (3, 2052),  # Windows Simplified Chinese
        (3, 1028),  # Windows Traditional Chinese
        (1, 33),    # Mac Chinese
    ]

    priority = CN_PRIORITY if prefer_chinese else EN_PRIORITY

    records = {}
    for record in name_table.names:
        if record.nameID == name_id:
            try:
                text = record.toUnicode()
                if text and text.strip():
                    records[(record.platformID, record.langID)] = text.strip()
            except Exception:
                pass

    for plat, lang in priority:
        if (plat, lang) in records:
            return records[(plat, lang)]

    for text in records.values():
        return text

    return None


def parse_font(filepath: str) -> dict:
    """Parse a font file and return metadata."""
    fmt = detect_format(filepath)
    if fmt is None:
        raise ValueError("Unsupported file format: {}".format(os.path.splitext(filepath)[1]))

    try:
        font = TTFont(filepath, fontNumber=0)
    except Exception as e:
        raise ValueError("Failed to parse font file: {}".format(e)) from e

    try:
        name_table = font.get("name")
        if name_table is None:
            raise ValueError("Font has no name table")

        # Family name: prefer Chinese (方正新秀丽繁体)
        family_name = (
            _get_name(name_table, 1, prefer_chinese=True)
            or _get_name(name_table, 16, prefer_chinese=True)
        )

        # Style name: prefer English (Regular, Bold, Italic)
        style_name = (
            _get_name(name_table, 2, prefer_chinese=False)
            or _get_name(name_table, 17, prefer_chinese=False)
        )

        version = _get_name(name_table, 5, prefer_chinese=False) or ""
        full_name = _get_name(name_table, 4, prefer_chinese=True) or ""

        if not family_name:
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
    safe_family = _sanitize_filename(family_name)
    safe_style = _sanitize_filename(style_name)
    return "{}-{}.{}".format(safe_family, safe_style, ext)
