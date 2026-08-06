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

# Windows built-in fonts (family names) — auto-skip on import
WINDOWS_BUILTIN_FONTS = {
    # Latin / Core
    "Arial", "Arial Black", "Arial Narrow", "Arial Rounded MT Bold",
    "Calibri", "Calibri Light", "Cambria", "Cambria Math",
    "Candara", "Candara Light", "Comic Sans MS", "Consolas",
    "Constantia", "Corbel", "Corbel Light", "Courier New",
    "Ebrima", "Franklin Gothic Medium", "Gabriola", "Gadugi",
    "Georgia", "Impact", "Ink Free", "Javanese Text",
    "Leelawadee UI", "Leelawadee UI Semilight", "Lucida Console",
    "Lucida Sans Unicode", "MS Gothic", "MS PGothic", "MS UI Gothic",
    "MV Boli", "Malgun Gothic", "Malgun Gothic Semilight",
    "Marlett", "Microsoft Himalaya", "Microsoft JhengHei",
    "Microsoft JhengHei Light", "Microsoft JhengHei UI",
    "Microsoft JhengHei UI Light", "Microsoft New Tai Lue",
    "Microsoft PhagsPa", "Microsoft Sans Serif", "Microsoft Tai Le",
    "Microsoft YaHei", "Microsoft YaHei Light", "Microsoft YaHei UI",
    "Microsoft YaHei UI Light", "Microsoft Yi Baiti",
    "MingLiU-ExtB", "MingLiU_HKSCS", "MingLiU_HKSCS-ExtB",
    "Miriam", "Miriam Fixed", "Mongolian Baiti", "Myanmar Text",
    "NSimSun", "Nirmala UI", "Nirmala UI Semilight",
    "PMingLiU", "PMingLiU-ExtB", "Palatino Linotype",
    "Plantagenet Cherokee", "Rod", "Sakkal Majalla",
    "Segoe MDL2 Assets", "Segoe Print", "Segoe Script",
    "Segoe UI", "Segoe UI Black", "Segoe UI Emoji",
    "Segoe UI Historic", "Segoe UI Light", "Segoe UI Semibold",
    "Segoe UI Semilight", "Segoe UI Symbol", "Shonar Bangla",
    "SimHei", "SimSun", "SimSun-ExtB", "Simplified Arabic",
    "Simplified Arabic Fixed", "Sitka", "Sylfaen", "Symbol",
    "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
    "Vrinda", "Webdings", "Wingdings", "Wingdings 2", "Wingdings 3",
    "Yu Gothic", "Yu Gothic Light", "Yu Gothic Medium", "Yu Gothic UI",
    "Yu Gothic UI Light", "Yu Gothic UI Semibold", "Yu Gothic UI Semilight",
    "BIZ UDGothic", "BIZ UDMincho Medium",
    # Common CJK system fonts
    "新宋体", "宋体", "黑体", "楷体", "仿宋",
    "微软雅黑", "微軟雅黑", "微软正黑", "微軟正黑體", "微软正黑体",
    "细明体", "細明體", "新细明体", "新細明體",
    "Ming(for ISO10646)", "PMingLiU-ExtB",
    "MS Mincho", "MS PMincho", "Meiryo", "Meiryo UI",
    "Yu Mincho",
    # Windows 10+ bundled CJK fonts
    "DengXian", "等线",
    "DengXian Light", "等线 Light",
    "DengXian Bold", "等线 Bold",
}

_WINDOWS_BUILTIN_LOWER = {n.lower() for n in WINDOWS_BUILTIN_FONTS}


def is_windows_builtin(family_name: str) -> bool:
    """Check if a font family name matches a Windows built-in font."""
    return family_name.strip().lower() in _WINDOWS_BUILTIN_LOWER


_ZH_LANGS = {(3, 2052), (3, 1028), (1, 33)}
_EN_LANGS = {(3, 1033), (1, 0)}
_COLLECT_LANGS = _ZH_LANGS | _EN_LANGS

_WEIGHT_EN = sorted([
    "Thin", "Hairline",
    "Extra Light", "ExtraLight", "Ultra Light", "UltraLight",
    "Semi Light", "SemiLight",
    "Demi Light", "DemiLight",
    "Light", "Regular", "Normal", "Medium",
    "Semi Bold", "SemiBold", "Demi Bold", "DemiBold",
    "Bold", "Extra Bold", "ExtraBold", "Ultra Bold", "UltraBold",
    "Heavy", "Black",
], key=len, reverse=True)

_WEIGHT_ZH = sorted([
    "极细", "超细", "纤细",
    "轻体", "輕體",
    "常规", "常規", "标准", "標準",
    "中粗", "半粗",
    "粗体", "粗體",
    "特粗", "超粗",
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
            return result[:-len(sfx)].strip(" -_")
    for w in _WEIGHT_EN:
        if result.lower().endswith(w.lower()):
            return result[:-len(w)].strip(" -_")
    for w in _WEIGHT_ZH:
        if result.endswith(w):
            return result[:-len(w)].strip(" -_")
    for d in _DESCRIPTORS:
        if _is_cjk(d):
            if result.endswith(d):
                return result[:-len(d)].strip(" -_")
        else:
            if result.lower().endswith(d.lower()):
                return result[:-len(d)].strip(" -_")
    return result


def _clean_family_name(name: str) -> str:
    prev = None
    result = name
    while result != prev:
        prev = result
        result = _strip_once(result)
    return result


_VARIANT_MARKERS = [" Mono", "Mono "]


def _strip_variant(name: str) -> str:
    """Strip variant markers like 'Mono' from family name for comparison."""
    result = name
    for marker in _VARIANT_MARKERS:
        result = result.replace(marker, " ")
    return re.sub(r'\s+', ' ', result).strip()


def _find_common_ttc_name(all_names: List[Tuple[str, str]]) -> Optional[str]:
    if not all_names:
        return None
    cn_names = [n for n, lang in all_names if lang == 'zh']
    en_names = [n for n, lang in all_names if lang == 'en']
    if cn_names:
        cn_bases = list(set(_strip_variant(_clean_family_name(n)) for n in cn_names))
        for b in cn_bases:
            if _is_simplified_chinese(b):
                return b
        return cn_bases[0]
    if en_names:
        en_bases = [_strip_variant(_clean_family_name(n)) for n in en_names]
        return Counter(en_bases).most_common(1)[0][0]
    all_bases = [_strip_variant(_clean_family_name(n)) for n, _ in all_names]
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


def _detect_region_from_name(name: str) -> str:
    """Detect region code from a font name string."""
    upper = name.upper()
    # Use word boundary matching: check for region codes as separate words
    import re
    # Match region codes surrounded by word boundaries or hyphens
    m = re.search(r'(?:^|[\s\-])(SC|TC|HK|HC|JP|KR|CN|TW|JA|KO)(?:$|[\s\-])', upper)
    if m:
        code = m.group(1)
        if code in ("SC", "CN"):
            return "SC"
        if code in ("TC", "TW"):
            return "TC"
        if code in ("HK", "HC"):
            return "HK"
        if code in ("JP", "JA"):
            return "JP"
        if code in ("KR", "KO"):
            return "KR"
    if "简体" in name or "简" in name:
        return "SC"
    if "繁体" in name or "繁" in name:
        return "TC"
    return ""


def _detect_region_from_langid(name_table) -> str:
    """Detect region from name table language IDs as fallback."""
    if name_table is None:
        return ""
    has_sc = False
    has_tc = False
    has_ja = False
    has_ko = False
    for record in name_table.names:
        if record.nameID not in (1, 4):
            continue
        if record.platformID == 3:
            if record.langID == _LANG_SC:
                has_sc = True
            elif record.langID == _LANG_TC:
                has_tc = True
            elif record.langID == _LANG_JA:
                has_ja = True
            elif record.langID == _LANG_KO:
                has_ko = True
        elif record.platformID == 1 and record.langID == 33:
            has_sc = True
    # Return the most specific region
    if has_sc:
        return "SC"
    if has_tc:
        return "TC"
    if has_ja:
        return "JP"
    if has_ko:
        return "KR"
    return ""


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
            full_name = _get_name(name_table, 4, prefer_chinese=True) or ""

            # Detect region: try family name first, then full name, then langID
            region = _detect_region_from_name(family)
            if not region:
                region = _detect_region_from_name(full_name)
            if not region:
                region = _detect_region_from_langid(name_table)

            # Detect weight from style name (most reliable)
            weight = style
            for w in _WEIGHT_EN:
                if style.lower().endswith(w.lower()) or w.lower() in style.lower():
                    weight = w
                    break
            # Also try family name for weight
            for w in _WEIGHT_EN:
                if family.lower().endswith(w.lower()):
                    weight = w
                    break

            # Detect variant (e.g. Mono) from family name
            variant = ""
            family_lower = family.lower()
            if "mono" in family_lower:
                variant = "Mono"

            results.append({"index": i, "family_name": family,
                            "style_name": style, "region": region,
                            "weight": weight, "variant": variant})
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



# ─── Cmap fingerprint & naming correction ────────────────────────────────────

import hashlib


def compute_cmap_fingerprint(filepath: str) -> Optional[dict]:
    """Compute a lightweight cmap fingerprint for single TTF/OTF (not TTC).

    Returns {"hash": str, "glyph_count": int, "version": str} or None on error.
    """
    fmt = detect_format(filepath)
    if fmt != "ttf" and fmt != "otf":
        return None
    try:
        font = TTFont(filepath, fontNumber=0)
    except Exception:
        return None
    try:
        cmap = font.getBestCmap()
        if not cmap:
            return None
        # Hash first 200 sorted codepoints for a lightweight fingerprint
        sample = sorted(cmap.keys())[:200]
        h = hashlib.md5(str(sample).encode()).hexdigest()
        glyph_count = len(cmap)

        version = ""
        name_table = font.get("name")
        if name_table:
            for r in name_table.names:
                if r.nameID == 5 and r.platformID == 3 and r.langID == 1033:
                    try:
                        version = r.toUnicode().strip()
                        break
                    except Exception:
                        pass

        return {"hash": h, "glyph_count": glyph_count, "version": version}
    finally:
        font.close()


def extract_weight_from_name(family_name: str) -> Tuple[str, str]:
    """Extract weight word from family name if present.

    Returns (base_name, weight). If no weight found, returns (family_name, "").
    Example: "05HomuraM-SemiBold" -> ("HomuraM", "SemiBold")
    """
    # Try English weights (longest first)
    for w in _WEIGHT_EN:
        lower = family_name.lower()
        if lower.endswith(w.lower()):
            base = family_name[:len(family_name) - len(w)].strip(" -_")
            # Strip leading digits (e.g., "05HomuraM" -> "HomuraM")
            base = re.sub(r'^\d+', '', base).strip(" -_")
            if base:
                return base, w
    # Try Chinese multi-char weights
    for w in _WEIGHT_ZH:
        if family_name.endswith(w):
            base = family_name[:len(family_name) - len(w)].strip(" -_")
            base = re.sub(r'^\d+', '', base).strip(" -_")
            if base:
                return base, w
    return family_name, ""


def detect_common_base_name(family_names: list) -> str:
    """Detect the common base name from a list of family names that contain weights.

    Example: ["01HomuraM-ExtraLight", "02HomuraM-Light", ...] -> "HomuraM"
    """
    bases = []
    for name in family_names:
        base, weight = extract_weight_from_name(name)
        if weight:
            bases.append(base)
    if not bases:
        return ""
    # Return the shortest base (most likely the true name)
    # All bases should be the same after extraction
    return min(bases, key=len)


def is_non_standard_naming(family_name: str, style_name: str) -> bool:
    """Check if a font has non-standard naming (weight in family, style=Regular)."""
    if style_name.lower() != "regular":
        return False
    _, weight = extract_weight_from_name(family_name)
    return bool(weight)


def rewrite_font_names(filepath: str, new_family: str, new_style: str) -> bool:
    """Rewrite a font file's name table with corrected family/style names.

    Modifies nameID 1, 2, 4, 16, 17. Keeps nameID 6 (PostScript) unchanged.
    Returns True on success.

    WARNING: Do NOT call this for OTF (CFF) fonts! fontTools.save() destructively
    re-encodes CID-keyed CFF table data, losing up to 30% of the binary data and
    causing browser rendering failures. For OTF fonts, only update DB metadata.
    """
    try:
        font = TTFont(filepath, fontNumber=0)
    except Exception:
        return False

    try:
        name_table = font.get("name")
        if name_table is None:
            return False

        new_full = "{} {}".format(new_family, new_style) if new_style != "Regular" else new_family

        # Platforms to update: (platformID, encodingID, languageID)
        targets = [
            (1, 0, 0),       # Mac English
            (3, 1, 1033),    # Windows English
        ]
        # Also add Chinese if present
        zh_targets = [
            (3, 1, 2052),    # Windows Chinese Simplified
            (3, 1, 1028),    # Windows Chinese Traditional
            (1, 1, 33),      # Mac Chinese
        ]

        for record in list(name_table.names):
            pid, eid, lid = record.platformID, record.platEncID, record.langID

            # Check if this is a target we should update
            is_target = (pid, eid, lid) in targets
            is_zh_target = (pid, eid, lid) in zh_targets

            if not is_target and not is_zh_target:
                continue

            if record.nameID == 1:  # family name
                record.string = new_family
            elif record.nameID == 2:  # style name
                record.string = new_style
            elif record.nameID == 4:  # full name
                record.string = new_full
            elif record.nameID == 16:  # typographic family
                record.string = new_family
            elif record.nameID == 17:  # typographic style
                record.string = new_style

        # Update CFF internal names (used by macOS/WebKit for font matching)
        cff = font.get("CFF ")
        if cff is not None:
            try:
                cff_obj = cff.cff
                for i in range(len(cff_obj.topDictIndex)):
                    top = cff_obj.topDictIndex[i]
                    top.FullName = new_full.encode("ascii", errors="replace")
                    top.FamilyName = new_family.encode("ascii", errors="replace")
                    if new_style.lower() != "regular":
                        top.Weight = new_style.encode("ascii", errors="replace")
                    else:
                        top.Weight = b"Regular"
            except Exception:
                pass  # CFF update is best-effort

        font.save(filepath)
        return True
    except Exception:
        return False
    finally:
        try:
            font.close()
        except Exception:
            pass


def get_raw_family_name(filepath: str) -> Optional[str]:
    """Get the raw family name (nameID=1 or 16) without cleaning."""
    fmt = detect_format(filepath)
    if fmt is None:
        return None
    if fmt == "ttc":
        return None  # Skip TTC
    try:
        font = TTFont(filepath, fontNumber=0)
    except Exception:
        return None
    try:
        name_table = font.get("name")
        if name_table is None:
            return None
        return _get_name(name_table, 1, prefer_chinese=True) or _get_name(name_table, 16, prefer_chinese=True)
    finally:
        font.close()


def compare_font_glyphs(original_path: str, modified_path: str, sample_size: int = 100) -> dict:
    """Compare glyph data between two font files.
    
    Returns dict with:
      - match: bool (True if glyphs are identical)
      - checked: int (number of glyphs checked)
      - mismatches: list of glyph names that differ
      - error: str or None
    """
    from fontTools.ttLib import TTFont
    import random
    
    result = {"match": True, "checked": 0, "mismatches": [], "error": None}
    
    try:
        font_orig = TTFont(original_path)
        font_mod = TTFont(modified_path)
    except Exception as e:
        result["error"] = f"Failed to open font: {e}"
        return result
    
    try:
        # Get glyph orders
        order_orig = font_orig.getGlyphOrder()
        order_mod = font_mod.getGlyphOrder()
        
        if len(order_orig) != len(order_mod):
            result["match"] = False
            result["error"] = f"Glyph count differs: {len(order_orig)} vs {len(order_mod)}"
            return result
        
        # Get CharStrings
        cff_orig = font_orig.get('CFF ')
        cff_mod = font_mod.get('CFF ')
        
        if not cff_orig or not cff_mod:
            result["error"] = "Missing CFF table"
            return result
        
        cs_orig = cff_orig.cff.topDictIndex[0].CharStrings
        cs_mod = cff_mod.cff.topDictIndex[0].CharStrings
        
        # Sample glyphs to check
        total = len(order_orig)
        if total <= sample_size:
            indices = range(total)
        else:
            # Sample evenly, always include first 10 (common glyphs)
            indices = list(range(10)) + sorted(random.sample(range(10, total), min(sample_size - 10, total - 10)))
        
        for i in indices:
            gname = order_orig[i]
            try:
                t2_orig = cs_orig[gname]
                t2_mod = cs_mod[gname]
                t2_orig.decompile()
                t2_mod.decompile()
                
                if t2_orig.program != t2_mod.program:
                    result["mismatches"].append(gname)
                    result["match"] = False
            except Exception:
                # Skip glyphs that can't be decompiled
                pass
            
            result["checked"] += 1
        
    except Exception as e:
        result["error"] = f"Comparison failed: {e}"
    finally:
        font_orig.close()
        font_mod.close()
    
    return result
