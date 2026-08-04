"""Font file parser using fontTools.

Handles TTF, OTF, and TTC files.
- Family name: prefers Chinese (Simplified > Traditional), then English
- Style name: prefers English (Regular/Bold/Italic are standard)
- TTC: examines all sub-fonts, finds common base family name
"""

import os
import re
from collections import Counter
from typing import Optional, List, Tuple
from fontTools.ttLib import TTFont, TTCollection

SUPPORTED_EXTENSIONS = {".ttf", ".otf", ".ttc"}

# Platform/language combos to collect for family names
# (platformID, langID, label)
_ZH_LANGS = {(3, 2052), (3, 1028), (1, 33)}   # Simplified CN, Traditional CN, Mac Chinese
_EN_LANGS = {(3, 1033), (1, 0)}                 # Windows English, Mac English
_COLLECT_LANGS = _ZH_LANGS | _EN_LANGS


def detect_format(filepath: str) -> Optional[str]:
    ext = os.path.splitext(filepath)[1].lower()
    if ext in SUPPORTED_EXTENSIONS:
        return ext.lstrip(".")
    return None


def _sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def _is_cjk(text: str) -> bool:
    return any('\u4e00' <= c <= '\u9fff' for c in text)


def _is_simplified_chinese(text: str) -> bool:
    """Heuristic: chars common in Traditional but not Simplified."""
    trad_only = set('體國標準號機電區開關東車馬魚鳥書學門飛車紅綠藍黃語言讀寫聽說點線圓雲長短高低')
    return _is_cjk(text) and not any(c in trad_only for c in text)


def _get_name(name_table, name_id: int, prefer_chinese: bool = True) -> Optional[str]:
    """Get a name record with configurable language priority."""
    CN_PRIORITY = [
        (3, 2052), (3, 1028), (1, 33),
        (3, 1033), (1, 0),
    ]
    EN_PRIORITY = [
        (3, 1033), (1, 0),
        (3, 2052), (3, 1028), (1, 33),
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


def _get_zh_en_family_names(name_table) -> List[Tuple[str, str]]:
    """Get Chinese and English family names (nameID=1, 16) with language tag.

    Returns list of (name, lang_tag) where lang_tag is 'zh' or 'en'.
    Only collects from known Chinese/English platform/lang combos.
    """
    results = []
    seen = set()
    for record in name_table.names:
        if record.nameID not in (1, 16):
            continue
        key = (record.platformID, record.langID, record.nameID)
        if key in seen:
            continue
        if (record.platformID, record.langID) not in _COLLECT_LANGS:
            continue
        try:
            text = record.toUnicode()
            if text and text.strip():
                text = text.strip()
                lang = 'zh' if (record.platformID, record.langID) in _ZH_LANGS else 'en'
                results.append((text, lang))
                seen.add(key)
        except Exception:
            pass
    return results


def _strip_suffix(name: str) -> str:
    """Strip CJK/region/weight suffixes to get base family name.

    Examples:
        Noto Sans CJK SC     → Noto Sans CJK
        Noto Serif CJK TC    → Noto Serif CJK
        宋體-簡               → 宋體
        黑体-繁               → 黑体
        Heiti SC             → Heiti
        冬青黑体简体中文 W3    → 冬青黑体简体中文
        Hiragino Sans GB W6  → Hiragino Sans GB
    """
    # Strip weight suffixes first
    name = re.sub(r'\s+W[1-9]$', '', name)

    suffixes = [
        " SC", " TC", " HK", " JP", " KR", " CN",
        "-SC", "-TC", "-HK", "-JP", "-KR", "-CN",
        "-簡", "-繁", "-简",
        "-簡體", "-繁體", "-简体", "-繁体",
    ]
    for s in suffixes:
        if name.endswith(s):
            return name[:-len(s)].strip()
    return name


def _find_common_ttc_name(all_names: List[Tuple[str, str]]) -> Optional[str]:
    """Find the best representative family name for a TTC.

    all_names: list of (name, 'zh' or 'en')

    Strategy:
      1. Separate Chinese vs English names
      2. Strip suffixes to get bases
      3. Among Chinese bases, prefer Simplified Chinese variant
      4. Among English bases, use most common
      5. Fall back to most frequent base overall
    """
    if not all_names:
        return None

    cn_names = [n for n, lang in all_names if lang == 'zh']
    en_names = [n for n, lang in all_names if lang == 'en']

    # Among Chinese names, find common base
    if cn_names:
        cn_bases = list(set(_strip_suffix(n) for n in cn_names))
        # Prefer Simplified Chinese variant
        for b in cn_bases:
            if _is_simplified_chinese(b):
                return b
        # If no clear Simplified Chinese, use first
        return cn_bases[0]

    # Among English names, find common base
    if en_names:
        en_bases = [_strip_suffix(n) for n in en_names]
        base_counter = Counter(en_bases)
        return base_counter.most_common(1)[0][0]

    # Fallback: use any name
    all_bases = [_strip_suffix(n) for n, _ in all_names]
    return Counter(all_bases).most_common(1)[0][0] if all_bases else None


def _parse_ttc(filepath: str) -> dict:
    """Parse a TTC file — examine all sub-fonts for common family name."""
    try:
        ttc = TTCollection(filepath)
    except Exception as e:
        raise ValueError("Failed to parse TTC file: {}".format(e)) from e

    try:
        all_family_names = []
        style_name = "Regular"
        version = ""
        full_name = ""

        for i, font in enumerate(ttc):
            name_table = font.get("name")
            if name_table is None:
                continue

            all_family_names.extend(_get_zh_en_family_names(name_table))

            if i == 0:
                style_name = _get_name(name_table, 2, prefer_chinese=False) or "Regular"
                version = _get_name(name_table, 5, prefer_chinese=False) or ""
                full_name = _get_name(name_table, 4, prefer_chinese=True) or ""

        if not all_family_names:
            raise ValueError("TTC has no readable family names")

        family_name = _find_common_ttc_name(all_family_names)

        if not family_name:
            family_name = "Unknown"

        return {
            "family_name": family_name.strip(),
            "style_name": style_name.strip(),
            "format": "ttc",
            "version": version.strip(),
            "full_name": full_name.strip(),
        }
    finally:
        ttc.close()


def parse_font(filepath: str) -> dict:
    """Parse a font file and return metadata."""
    fmt = detect_format(filepath)
    if fmt is None:
        raise ValueError("Unsupported file format: {}".format(os.path.splitext(filepath)[1]))

    if fmt == "ttc":
        return _parse_ttc(filepath)

    # TTF/OTF
    try:
        font = TTFont(filepath, fontNumber=0)
    except Exception as e:
        raise ValueError("Failed to parse font file: {}".format(e)) from e

    try:
        name_table = font.get("name")
        if name_table is None:
            raise ValueError("Font has no name table")

        family_name = (
            _get_name(name_table, 1, prefer_chinese=True)
            or _get_name(name_table, 16, prefer_chinese=True)
        )
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
