"""Font file parser using fontTools.

Handles TTF, OTF, and TTC files.
- Family name: prefers Chinese (Simplified > Traditional), then English
- Style name: prefers English (Regular/Bold/Italic are standard)
- TTC: examines all sub-fonts, finds common base family name

Naming cleanup rules:
  - Strip parenthetical content: (需授权), (Demo)
  - Strip language/region suffixes: SC, TC, HK, JP, KR
  - Strip weight/style suffixes: Light, Bold, Black, 粗, 细
  - Strip descriptors: 简入繁出, Demo, etc.
"""

import os
import re
from collections import Counter
from typing import Optional, List, Tuple
from fontTools.ttLib import TTFont, TTCollection

SUPPORTED_EXTENSIONS = {".ttf", ".otf", ".ttc"}

_ZH_LANGS = {(3, 2052), (3, 1028), (1, 33)}
_EN_LANGS = {(3, 1033), (1, 0)}
_COLLECT_LANGS = _ZH_LANGS | _EN_LANGS

# Weight/style suffixes (English, case-insensitive matching)
# Sorted longest first so "Extra Bold" matches before "Bold"
_WEIGHT_EN = sorted([
    "Thin", "Hairline",
    "Extra Light", "ExtraLight", "Ultra Light", "UltraLight",
    "Light",
    "Regular", "Normal",
    "Medium",
    "Semi Bold", "SemiBold", "Demi Bold", "DemiBold",
    "Bold",
    "Extra Bold", "ExtraBold", "Ultra Bold", "UltraBold",
    "Heavy", "Black",
], key=len, reverse=True)

# Weight suffixes (Chinese), sorted longest first
_WEIGHT_ZH = sorted([
    "极细", "超细", "細", "细", "纤细",
    "轻", "輕", "轻体", "輕體",
    "常规", "常規", "标准", "標準",
    "中", "中粗", "半粗",
    "粗", "粗体", "粗體",
    "特粗", "超粗", "黑", "重",
], key=len, reverse=True)

# Descriptors to strip (NOT 繁体/简体 — those are part of font names)
_DESCRIPTORS = sorted([
    "简入繁出", "繁入简出", "简入繁出版", "繁入简出版",
    "Demo", "Trial", "Free", "Personal", "Commercial",
    "Subset", "Full",
], key=len, reverse=True)

# Region/language suffixes
_REGION_SUFFIXES = sorted([
    " SC", " TC", " HK", " JP", " KR", " CN",
    "-SC", "-TC", "-HK", "-JP", "-KR", "-CN",
    "-簡", "-繁", "-简",
], key=len, reverse=True)


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
    trad_only = set('體國標準號機電區開關東車馬魚鳥書學門飛車紅綠藍黃語言讀寫聽說點線圓雲長短高低')
    return _is_cjk(text) and not any(c in trad_only for c in text)


def _get_name(name_table, name_id: int, prefer_chinese: bool = True) -> Optional[str]:
    CN_PRIORITY = [(3, 2052), (3, 1028), (1, 33), (3, 1033), (1, 0)]
    EN_PRIORITY = [(3, 1033), (1, 0), (3, 2052), (3, 1028), (1, 33)]

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
    """Get Chinese and English family names (nameID=1, 16) with language tag."""
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


def _strip_once(s: str) -> str:
    """Apply one round of suffix stripping. Returns stripped string or original."""
    result = s

    # 1. Parenthetical content at end: (...) or （...）
    new = re.sub(r'\s*[（\(][^）\)]*[）\)]\s*$', '', result).strip()
    if new != result:
        return new

    # 2. Weight numbers: W1-W9
    new = re.sub(r'\s*[-]?\s*W[1-9]\s*$', '', result).strip()
    if new != result:
        return new

    # 3. Region suffixes
    for sfx in _REGION_SUFFIXES:
        if result.endswith(sfx):
            return result[:-len(sfx)].strip()

    # 4. Weight suffixes (English)
    for w in _WEIGHT_EN:
        if result.lower().endswith(w.lower()):
            return result[:-len(w)].strip()

    # 5. Weight suffixes (Chinese)
    for w in _WEIGHT_ZH:
        if result.endswith(w):
            return result[:-len(w)].strip()

    # 6. Descriptors
    for d in _DESCRIPTORS:
        if _is_cjk(d):
            if result.endswith(d):
                return result[:-len(d)].strip()
        else:
            if result.lower().endswith(d.lower()):
                return result[:-len(d)].strip()

    return result


def _clean_family_name(name: str) -> str:
    """Strip all modifiers to get base family name.

    Applies stripping repeatedly until stable, so multiple suffixes
    like "CJK SC Black" are fully removed.
    """
    prev = None
    result = name
    while result != prev:
        prev = result
        result = _strip_once(result)
    return result


def _find_common_ttc_name(all_names: List[Tuple[str, str]]) -> Optional[str]:
    """Find the best representative family name for a TTC."""
    if not all_names:
        return None

    cn_names = [n for n, lang in all_names if lang == 'zh']
    en_names = [n for n, lang in all_names if lang == 'en']

    if cn_names:
        cn_bases = list(set(_clean_family_name(n) for n in cn_names))
        for b in cn_bases:
            if _is_simplified_chinese(b):
                return b
        return cn_bases[0]

    if en_names:
        en_bases = [_clean_family_name(n) for n in en_names]
        base_counter = Counter(en_bases)
        return base_counter.most_common(1)[0][0]

    all_bases = [_clean_family_name(n) for n, _ in all_names]
    return Counter(all_bases).most_common(1)[0][0] if all_bases else None


def _parse_ttc(filepath: str) -> dict:
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

        family_name = _find_common_ttc_name(all_family_names) or "Unknown"

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
    fmt = detect_format(filepath)
    if fmt is None:
        raise ValueError("Unsupported file format: {}".format(os.path.splitext(filepath)[1]))

    if fmt == "ttc":
        return _parse_ttc(filepath)

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

        family_name = _clean_family_name(family_name)

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


def get_ttc_subfonts(filepath: str) -> list:
    """Get metadata for all sub-fonts in a TTC file.

    Returns list of dicts: {index, family_name, style_name}
    """
    from fontTools.ttLib import TTCollection

    ttc = TTCollection(filepath)
    results = []
    try:
        for i, font in enumerate(ttc):
            name_table = font.get("name")
            if name_table is None:
                results.append({"index": i, "family_name": "Sub-font {}".format(i), "style_name": ""})
                continue

            family = (
                _get_name(name_table, 1, prefer_chinese=True)
                or _get_name(name_table, 16, prefer_chinese=True)
                or "Sub-font {}".format(i)
            )
            style = _get_name(name_table, 2, prefer_chinese=False) or ""
            results.append({"index": i, "family_name": family, "style_name": style})
    finally:
        ttc.close()

    return results
