"""Font file parser using fontTools."""

import logging
import os
import re
from collections import Counter
from typing import Optional, List, Tuple
from fontTools.ttLib import TTFont, TTCollection

# Suppress noisy fontTools warnings
logging.getLogger("fontTools").setLevel(logging.ERROR)

SUPPORTED_EXTENSIONS = {".ttf", ".otf", ".ttc"}

_ZH_LANGS = {(3, 2052), (3, 1028), (1, 33)}
_EN_LANGS = {(3, 1033), (1, 0)}
_COLLECT_LANGS = _ZH_LANGS | _EN_LANGS

_WEIGHT_EN = sorted([
    "Thin", "Hairline",
    "Extra Light", "ExtraLight", "Ultra Light", "UltraLight",
    "Light", "Regular", "Normal", "Medium",
    "Semi Bold", "SemiBold", "Demi Bold", "DemiBold",
    "Bold", "Extra Bold", "ExtraBold", "Ultra Bold", "UltraBold",
    "Heavy", "Black",
], key=len, reverse=True)

_WEIGHT_ZH = sorted([
    "极细", "超细", "細", "细", "纤细",
    "轻", "輕", "轻体", "輕體",
    "常规", "常規", "标准", "標準",
    "中", "中粗", "半粗",
    "粗", "粗体", "粗體",
    "特粗", "超粗", "黑", "重",
], key=len, reverse=True)

_DESCRIPTORS = sorted([
    "简入繁出", "繁入简出", "简入繁出版", "繁入简出版",
    "Demo", "Trial", "Free", "Personal", "Commercial",
    "Subset", "Full",
], key=len, reverse=True)

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
                lang = 'zh' if (record.platformID, record.langID) in _ZH_LANGS else 'en'
                results.append((text.strip(), lang))
                seen.add(key)
        except Exception:
            pass
    return results


def _strip_suffix(name: str) -> str:
    name = re.sub(r'\s+W[1-9]\s*$', '', name).strip()
    for s in [" SC", " TC", " HK", " JP", " KR", " CN",
              "-SC", "-TC", "-HK", "-JP", "-KR", "-CN",
              "-簡", "-繁", "-简"]:
        if name.endswith(s):
            return name[:-len(s)].strip()
    return name


def _strip_once(s: str) -> str:
    result = s
    new = re.sub(r'\s*[（\(][^）\)]*[）\)]\s*$', '', result).strip()
    if new != result:
        return new
    new = re.sub(r'\s*[-]?\s*W[1-9]\s*$', '', result).strip()
    if new != result:
        return new
    for sfx in _REGION_SUFFIXES:
        if result.endswith(sfx):
            return result[:-len(sfx)].strip()
    for w in _WEIGHT_EN:
        if result.lower().endswith(w.lower()):
            return result[:-len(w)].strip()
    for w in _WEIGHT_ZH:
        if result.endswith(w):
            return result[:-len(w)].strip()
    for d in _DESCRIPTORS:
        if _is_cjk(d):
            if result.endswith(d):
                return result[:-len(d)].strip()
        else:
            if result.lower().endswith(d.lower()):
                return result[:-len(d)].strip()
    return result


def _clean_family_name(name: str) -> str:
    prev = None
    result = name
    while result != prev:
        prev = result
        result = _strip_once(result)
    return result


def _find_common_ttc_name(all_names: List[Tuple[str, str]]) -> Optional[str]:
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
        return Counter(en_bases).most_common(1)[0][0]
    all_bases = [_clean_family_name(n) for n, _ in all_names]
    return Counter(all_bases).most_common(1)[0][0] if all_bases else None


def _parse_ttc(filepath: str) -> dict:
    ttc = TTCollection(filepath, lazy=True)
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
        return {"family_name": family_name.strip(), "style_name": style_name.strip(),
                "format": "ttc", "version": version.strip(), "full_name": full_name.strip()}
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
        family_name = (_get_name(name_table, 1, prefer_chinese=True)
                       or _get_name(name_table, 16, prefer_chinese=True))
        style_name = (_get_name(name_table, 2, prefer_chinese=False)
                      or _get_name(name_table, 17, prefer_chinese=False))
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
        return {"family_name": family_name.strip(), "style_name": style_name.strip(),
                "format": fmt, "version": version.strip(), "full_name": full_name.strip()}
    finally:
        font.close()


def generate_filename(family_name: str, style_name: str, ext: str) -> str:
    safe_family = _sanitize_filename(family_name)
    safe_style = _sanitize_filename(style_name)
    return "{}-{}.{}".format(safe_family, safe_style, ext)


def get_ttc_subfonts(filepath: str) -> list:
    """Get metadata for all sub-fonts in a TTC, grouped by region+weight."""
    ttc = TTCollection(filepath, lazy=True)
    results = []
    try:
        for i, font in enumerate(ttc):
            name_table = font.get("name")
            if name_table is None:
                results.append({"index": i, "family_name": "Sub-font {}".format(i),
                                "style_name": "", "region": "", "weight": ""})
                continue
            family = (_get_name(name_table, 1, prefer_chinese=True)
                      or _get_name(name_table, 16, prefer_chinese=True)
                      or "Sub-font {}".format(i))
            style = _get_name(name_table, 2, prefer_chinese=False) or ""

            # Detect region from name
            region = ""
            family_upper = family.upper()
            if " SC " in family_upper or family_upper.endswith(" SC"):
                region = "SC"
            elif " TC " in family_upper or family_upper.endswith(" TC"):
                region = "TC"
            elif " HK " in family_upper or family_upper.endswith(" HK"):
                region = "HK"
            elif " JP " in family_upper or family_upper.endswith(" JP"):
                region = "JP"
            elif " KR " in family_upper or family_upper.endswith(" KR"):
                region = "KR"

            # Detect weight from name
            weight = style  # style_name usually has the weight
            for w in _WEIGHT_EN:
                if family.lower().endswith(w.lower()):
                    weight = w
                    break

            results.append({"index": i, "family_name": family,
                            "style_name": style, "region": region, "weight": weight})
    finally:
        ttc.close()
    return results


# ─── CJK support detection ───────────────────────────────────────────────────

_CJK_START = 0x4E00
_CJK_END   = 0x9FFF
_LANG_SC = 2052
_LANG_TC = 1028
_LANG_JA = 1041
_LANG_KO = 1042


def _detect_name_langs(font) -> dict:
    name_table = font.get("name")
    if name_table is None:
        return {"sc": False, "tc": False, "ja": False, "ko": False}
    langs = {"sc": False, "tc": False, "ja": False, "ko": False}
    for record in name_table.names:
        if record.nameID in (1, 4):
            if record.platformID == 3:
                if record.langID == _LANG_SC: langs["sc"] = True
                elif record.langID == _LANG_TC: langs["tc"] = True
                elif record.langID == _LANG_JA: langs["ja"] = True
                elif record.langID == _LANG_KO: langs["ko"] = True
            elif record.platformID == 1 and record.langID == 33:
                langs["sc"] = True
    return langs


def get_cjk_support(filepath: str, font_number: int = 0) -> dict:
    """Analyze CJK support.

    Optimization: for TTC files, only sample first few sub-fonts for cmap
    (all sub-fonts share glyph set) and scan name tables (fast, lightweight).
    """
    try:
        if filepath.lower().endswith(".ttc"):
            ttc = TTCollection(filepath, lazy=True)
            if font_number >= len(ttc):
                font_number = 0
        else:
            ttc = None
            font = TTFont(filepath, fontNumber=0)
    except Exception:
        return {"has_cjk": False, "cjk_count": 0, "languages": [],
                "supports_sc": False, "supports_tc": False,
                "supports_ja": False, "supports_ko": False, "warning": None}

    try:
        if ttc is not None:
            total = len(ttc)
            # cmap: all sub-fonts share the same glyph set, check first one only
            first_font = ttc[0]
            cmap = first_font.getBestCmap()
            has_cjk = any(_CJK_START <= cp <= _CJK_END for cp in cmap) if cmap else False
            cjk_count = sum(1 for cp in cmap if _CJK_START <= cp <= _CJK_END) if cmap else 0

            # Name table languages: sample up to 5 sub-fonts (covers all regions)
            all_langs = {"sc": False, "tc": False, "ja": False, "ko": False}
            sample_count = min(total, 5)
            step = max(1, total // sample_count)
            for i in range(0, total, step):
                if i >= sample_count * step:
                    break
                sf = ttc[i]
                sl = _detect_name_langs(sf)
                for k in all_langs:
                    if sl[k]:
                        all_langs[k] = True
                # Early exit if all detected
                if all(all_langs.values()):
                    break

            # Check target sub-font for warning
            target_langs = _detect_name_langs(ttc[font_number])

            # OS/2 from first sub-font
            os2 = ttc[0].get("OS/2")
        else:
            cmap = font.getBestCmap()
            has_cjk = any(_CJK_START <= cp <= _CJK_END for cp in cmap) if cmap else False
            cjk_count = sum(1 for cp in cmap if _CJK_START <= cp <= _CJK_END) if cmap else 0
            all_langs = _detect_name_langs(font)
            target_langs = all_langs
            os2 = font.get("OS/2")

        cp1 = getattr(os2, "ulCodePageRange1", 0) if os2 else 0

        supports_sc = all_langs["sc"] or bool(cp1 & (1 << 20))
        supports_tc = all_langs["tc"] or bool(cp1 & (1 << 19))
        supports_ja = all_langs["ja"] or bool(cp1 & (1 << 17))
        supports_ko = all_langs["ko"] or bool(cp1 & (1 << 18))

        if has_cjk and not (supports_sc or supports_tc or supports_ja or supports_ko):
            supports_sc = True

        languages = []
        if supports_sc: languages.append("zh-CN")
        if supports_tc: languages.append("zh-TW")
        if supports_ja: languages.append("ja")
        if supports_ko: languages.append("ko")

        warning = None
        if has_cjk and target_langs["ja"] and not target_langs["sc"] and not target_langs["tc"]:
            if not bool(cp1 & (1 << 20)) and not bool(cp1 & (1 << 19)):
                warning = "该子字体使用日本字形，中文显示可能不规范"

        return {"has_cjk": has_cjk, "cjk_count": cjk_count,
                "supports_sc": supports_sc, "supports_tc": supports_tc,
                "supports_ja": supports_ja, "supports_ko": supports_ko,
                "languages": languages, "warning": warning}
    finally:
        if ttc is not None:
            ttc.close()
        else:
            font.close()

