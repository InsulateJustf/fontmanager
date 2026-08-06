"""FontManager — Flask web application for font management."""

import io
import re
import json
import os
import shutil
import tempfile
import argparse
import zipfile
from flask import Flask, request, jsonify, send_from_directory, send_file
from waitress import serve

import db
from font_parser import (parse_font, generate_filename, detect_format,
                         get_ttc_subfonts, get_cjk_support, is_windows_builtin,
                         compute_cmap_fingerprint, is_non_standard_naming,
                         extract_weight_from_name, detect_common_base_name,
                         rewrite_font_names, get_raw_family_name,
                         compare_font_glyphs)

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080
DEFAULT_STORAGE_WINDOWS = r"C:\ProgramData\FontManager\fonts"

FONT_STORAGE = None
app = Flask(__name__, static_folder="static")


# Format completeness ranking: higher = more complete
_FORMAT_RANK = {"ttc": 3, "otf": 2, "ttf": 1}


def _is_more_complete(new_fmt, new_size, old_fmt, old_size):
    """Check if the new font is more complete than the existing one."""
    new_rank = _FORMAT_RANK.get(new_fmt, 0)
    old_rank = _FORMAT_RANK.get(old_fmt, 0)
    if new_rank != old_rank:
        return new_rank > old_rank
    # Same format rank — larger file = more complete
    return new_size > old_size


def _sanitize_dirname(name: str) -> str:
    """Sanitize a family name for use as a directory name."""
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def _get_backup_dir():
    """Get or create the backup directory."""
    backup_dir = os.path.join(FONT_STORAGE, "backup")
    os.makedirs(backup_dir, exist_ok=True)
    return backup_dir


def _backup_font(src_path: str, original_name: str) -> str:
    """Backup a font file before modification.
    
    Returns the backup file path, or None on failure.
    """
    try:
        backup_dir = _get_backup_dir()
        # Use timestamp to avoid overwriting
        import time
        timestamp = int(time.time())
        base, ext = os.path.splitext(original_name)
        backup_name = f"{base}_{timestamp}{ext}"
        backup_path = os.path.join(backup_dir, backup_name)
        shutil.copy2(src_path, backup_path)
        return backup_path
    except Exception as e:
        print(f"  ⚠️  备份失败: {e}")
        return None


def _restore_font(backup_path: str, dest_path: str) -> bool:
    """Restore a font file from backup.
    
    Returns True on success.
    """
    try:
        if not os.path.exists(backup_path):
            print(f"  ❌ 备份文件不存在: {backup_path}")
            return False
        shutil.copy2(backup_path, dest_path)
        return True
    except Exception as e:
        print(f"  ❌ 还原失败: {e}")
        return False


def _consolidate_family(family_name: str):
    """Move flat files of a family into a subdirectory when 2+ fonts exist."""
    dir_name = _sanitize_dirname(family_name)
    family_dir = os.path.join(FONT_STORAGE, dir_name)
    os.makedirs(family_dir, exist_ok=True)
    for font in db.get_fonts_by_family(family_name):
        stored = font["stored_filename"]
        if "/" in stored or "\\" in stored:
            continue
        old_path = os.path.join(FONT_STORAGE, stored)
        if not os.path.exists(old_path):
            continue
        new_path = os.path.join(family_dir, stored)
        if os.path.exists(new_path):
            continue
        shutil.move(old_path, new_path)
        new_stored = "{}/{}".format(dir_name, stored)
        conn = db.get_connection()
        conn.execute("UPDATE fonts SET stored_filename=? WHERE id=?", (new_stored, font["id"]))
        conn.commit()
        conn.close()


def get_default_storage():
    if os.name == "nt":
        return DEFAULT_STORAGE_WINDOWS
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")


def ensure_storage():
    os.makedirs(FONT_STORAGE, exist_ok=True)


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/upload", methods=["POST"])
def upload_font():
    if "files" not in request.files:
        return jsonify({"status": "error", "message": "No files provided"}), 400
    files = request.files.getlist("files")
    results = []
    for f in files:
        if not f.filename:
            results.append({"filename": "(empty)", "status": "error", "message": "Empty filename"})
            continue
        results.append(_process_single_file(f))
    return jsonify({"status": "ok", "results": results})


def _process_single_file(file_storage):
    original_name = file_storage.filename
    ext = os.path.splitext(original_name)[1].lower()

    if detect_format(original_name) is None:
        return {"filename": original_name, "status": "error",
                "message": "Unsupported format: {}".format(ext)}

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    tmp_path = tmp.name
    try:
        file_storage.save(tmp)
        tmp.close()

        meta = parse_font(tmp_path)
        family_name = meta["family_name"]
        style_name = meta["style_name"]
        fmt = meta["format"]

        # ── Cmap fingerprint & naming correction (TTF/OTF only) ──
        cmap_fp = None
        backup_path = None  # Will be set if rewrite_font_names is called
        if fmt in ("ttf", "otf"):
            cmap_fp = compute_cmap_fingerprint(tmp_path)
            if cmap_fp:
                raw_name = get_raw_family_name(tmp_path)
                if raw_name and is_non_standard_naming(raw_name, style_name):
                    # Always correct from raw name — no need to wait for related fonts
                    base, weight = extract_weight_from_name(raw_name)
                    if base and weight:
                        # Refine base name with related fonts if available
                        related = db.get_fonts_by_fingerprint(cmap_fp["hash"])
                        related = [r for r in related
                                   if r.get("cmap_fingerprint")
                                   and json.loads(r["cmap_fingerprint"]).get("glyph_count") == cmap_fp["glyph_count"]
                                   and json.loads(r["cmap_fingerprint"]).get("version") == cmap_fp["version"]]
                        if related:
                            all_names = [r["family_name"] for r in related] + [raw_name]
                            refined = detect_common_base_name(all_names)
                            if refined:
                                base = refined
                        # Backup original file before modification
                        backup_path = _backup_font(tmp_path, original_name)
                        
                        if rewrite_font_names(tmp_path, base, weight):
                            # Compare glyphs to ensure modification didn't corrupt data
                            if backup_path:
                                cmp = compare_font_glyphs(backup_path, tmp_path)
                                if not cmp["match"]:
                                    print(f"  ⚠️  字形数据不匹配，自动还原: {cmp['mismatches'][:3]}")
                                    if _restore_font(backup_path, tmp_path):
                                        # Use original metadata, don't rename
                                        pass
                                    else:
                                        # Restore failed, skip this file
                                        return {"filename": original_name, "status": "error",
                                                "message": "字形比对失败且还原失败"}
                            
                            family_name = base
                            style_name = weight
                            meta = parse_font(tmp_path)
                        # Update existing related fonts
                        for r in related:
                            r_fpath = os.path.join(FONT_STORAGE, r["stored_filename"])
                            r_raw = get_raw_family_name(r_fpath) if os.path.exists(r_fpath) else None
                            if r_raw:
                                _, r_weight = extract_weight_from_name(r_raw)
                            else:
                                _, r_weight = "", ""
                            if r_weight:
                                db.replace_font(
                                    r["id"], base, r_weight,
                                    r["format"], r["file_size"], r["file_hash"],
                                    r["stored_filename"], r["original_filename"],
                                    json.loads(r["cjk_info"]) if r.get("cjk_info") else None,
                                    json.loads(r["subfonts_info"]) if r.get("subfonts_info") else None,
                                )

        # Skip Windows built-in fonts
        if is_windows_builtin(family_name):
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
            return {"filename": original_name, "status": "skipped",
                    "message": "Windows 系统自带字体，已跳过",
                    "family_name": family_name, "style_name": style_name}

        new_file_size = os.path.getsize(tmp_path)

        # Check for existing font with same family+style
        existing = db.get_font_by_family_style(family_name, style_name)

        if existing:
            # Compare completeness
            if _is_more_complete(fmt, new_file_size, existing["format"], existing["file_size"]):
                # New font is more complete — replace old one
                old_path = os.path.join(FONT_STORAGE, existing["stored_filename"])
                if os.path.exists(old_path):
                    os.remove(old_path)
                db.delete_font(existing["id"])
            else:
                # Old font is more complete — skip
                return {"filename": original_name, "status": "duplicate",
                        "message": "已有更完整的版本: {} - {} ({} vs {})".format(
                            family_name, style_name, existing["format"].upper(), fmt.upper()),
                        "family_name": family_name, "style_name": style_name}

        new_filename = generate_filename(family_name, style_name, ext.lstrip("."))
        family_fonts = db.get_fonts_by_family(family_name)
        use_subdir = len(family_fonts) > 0
        if use_subdir:
            family_dir = os.path.join(FONT_STORAGE, _sanitize_dirname(family_name))
            os.makedirs(family_dir, exist_ok=True)
            dest_path = os.path.join(family_dir, new_filename)
            counter = 1
            while os.path.exists(dest_path):
                base, ext_part = os.path.splitext(new_filename)
                new_filename = "{}_{}{}".format(base, counter, ext_part)
                dest_path = os.path.join(family_dir, new_filename)
                counter += 1
            stored_filename = "{}/{}".format(_sanitize_dirname(family_name), new_filename)
        else:
            dest_path = os.path.join(FONT_STORAGE, new_filename)
            counter = 1
            while os.path.exists(dest_path):
                base, ext_part = os.path.splitext(new_filename)
                new_filename = "{}_{}{}".format(base, counter, ext_part)
                dest_path = os.path.join(FONT_STORAGE, new_filename)
                counter += 1
            stored_filename = new_filename
        shutil.move(tmp_path, dest_path)

        # If this family now has 2+ fonts, move existing flat ones into subdir
        if use_subdir:
            _consolidate_family(family_name)
        tmp_path = None

        file_size = os.path.getsize(dest_path)
        file_hash = db.compute_file_hash(dest_path)

        cjk_info = None
        subfonts_info = None
        if fmt == "ttc":
            cjk_info = get_cjk_support(dest_path, font_number=0)
            subfonts_info = get_ttc_subfonts(dest_path)
        else:
            cjk_info = get_cjk_support(dest_path, font_number=0)

        font_id = db.insert_font(
            family_name=family_name, style_name=style_name, fmt=fmt,
            file_size=file_size, file_hash=file_hash,
            stored_filename=stored_filename, original_filename=original_name,
            cjk_info=cjk_info, subfonts_info=subfonts_info,
            cmap_fingerprint=cmap_fp,
            backup_filename=backup_path,
        )

        msg = "Added: {} - {}".format(family_name, style_name)
        if existing:
            msg = "Replaced with more complete version: {} - {}".format(family_name, style_name)

        return {"filename": original_name, "status": "success",
                "message": msg, "font_id": font_id,
                "family_name": family_name, "style_name": style_name,
                "stored_filename": new_filename}

    except ValueError as e:
        return {"filename": original_name, "status": "error", "message": str(e)}
    except Exception as e:
        return {"filename": original_name, "status": "error",
                "message": "Unexpected error: {}".format(e)}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.route("/api/fonts", methods=["GET"])
def list_fonts():
    fonts = db.get_all_fonts()
    return jsonify({"status": "ok", "fonts": fonts})


@app.route("/api/fonts/<int:font_id>", methods=["DELETE"])
def delete_font(font_id):
    font = db.delete_font(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404
    file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError as e:
            return jsonify({"status": "warning",
                            "message": "Record deleted but file removal failed: {}".format(e)})
    return jsonify({"status": "ok",
                    "message": "Deleted: {} - {}".format(font["family_name"], font["style_name"])})


@app.route("/api/fonts/<int:font_id>/restore", methods=["POST"])
def restore_font(font_id):
    """Restore a font file from backup."""
    font = db.get_font_by_id(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404
    
    # Get backup path from database
    backup_path = font.get("backup_filename")
    if not backup_path or not os.path.exists(backup_path):
        return jsonify({"status": "error", 
                        "message": "未找到备份文件"}), 404
    
    # Restore the file
    stored = font["stored_filename"]
    file_path = os.path.join(FONT_STORAGE, stored)
    if _restore_font(backup_path, file_path):
        # Update DB metadata (re-parse the restored file)
        meta = parse_font(file_path)
        file_size = os.path.getsize(file_path)
        file_hash = db.compute_file_hash(file_path)
        
        db.replace_font(
            font_id, meta["family_name"], meta["style_name"],
            meta["format"], file_size, file_hash,
            stored, font["original_filename"],
            None, None  # Will be re-cached on next access
        )
        
        return jsonify({"status": "ok",
                        "message": "已还原: {} - {}".format(meta["family_name"], meta["style_name"])})
    else:
        return jsonify({"status": "error", "message": "还原失败"}), 500


@app.route("/api/fonts/<int:font_id>/file", methods=["GET"])
def get_font_file(font_id):
    font = db.get_font_by_id(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404
    file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": "Font file missing"}), 404

    as_download = request.args.get("download") == "1"
    if as_download:
        # Use stored_filename (renamed) for download
        return send_file(file_path, as_attachment=True, download_name=font["stored_filename"])

    subfont_index = request.args.get("subfont")
    if subfont_index is not None and font["format"] == "ttc":
        try:
            subfont_index = int(subfont_index)
        except ValueError:
            return jsonify({"status": "error", "message": "Invalid subfont index"}), 400
        return _extract_ttc_subfont(file_path, subfont_index)

    mime_map = {"ttf": "font/ttf", "otf": "font/otf", "ttc": "font/collection"}
    mime = mime_map.get(font["format"], "application/octet-stream")
    return send_file(file_path, mimetype=mime)


def _extract_ttc_subfont(file_path, subfont_index):
    from fontTools.ttLib import TTCollection
    try:
        ttc = TTCollection(file_path, lazy=True)
        if subfont_index < 0 or subfont_index >= len(ttc):
            return jsonify({"status": "error",
                            "message": "Subfont index out of range (0-{})".format(len(ttc) - 1)}), 400
        buf = io.BytesIO()
        ttc[subfont_index].save(buf)
        buf.seek(0)
        ttc.close()
        return send_file(buf, mimetype="font/ttf")
    except Exception as e:
        return jsonify({"status": "error",
                        "message": "Failed to extract subfont: {}".format(e)}), 500


@app.route("/api/fonts/<int:font_id>/subfonts", methods=["GET"])
def list_subfonts(font_id):
    font = db.get_font_by_id(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404

    if font["format"] != "ttc":
        return jsonify({"status": "ok", "subfonts": [
            {"index": 0, "family_name": font["family_name"],
             "style_name": font["style_name"], "region": "", "weight": ""}
        ]})

    cached = font.get("subfonts_info")
    if cached:
        if isinstance(cached, str):
            cached = json.loads(cached)
        return jsonify({"status": "ok", "subfonts": cached})

    file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": "Font file missing"}), 404
    try:
        subfonts = get_ttc_subfonts(file_path)
        return jsonify({"status": "ok", "subfonts": subfonts})
    except Exception as e:
        return jsonify({"status": "error", "message": "Failed to read TTC: {}".format(e)}), 500


@app.route("/api/fonts/<int:font_id>/cjk", methods=["GET"])
def check_cjk(font_id):
    font = db.get_font_by_id(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404

    cached = font.get("cjk_info")
    if cached:
        if isinstance(cached, str):
            cached = json.loads(cached)
        return jsonify({"status": "ok", "cjk": cached})

    file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": "Font file missing"}), 404
    try:
        result = get_cjk_support(file_path, font_number=0)
        return jsonify({"status": "ok", "cjk": result})
    except Exception as e:
        return jsonify({"status": "error", "message": "Failed to analyze font: {}".format(e)}), 500


def parse_args():
    parser = argparse.ArgumentParser(description="FontManager")
    parser.add_argument("-s", "--storage",
                        default=os.environ.get("FONT_STORAGE", get_default_storage()),
                        help="Font storage directory (default: %(default)s)")
    parser.add_argument("-p", "--port", type=int,
                        default=int(os.environ.get("FONT_PORT", DEFAULT_PORT)),
                        help="Server port (default: %(default)s)")
    parser.add_argument("--host",
                        default=os.environ.get("FONT_HOST", DEFAULT_HOST),
                        help="Server host (default: %(default)s)")
    return parser.parse_args()
@app.route("/api/fonts/download-all", methods=["GET"])
def download_all_fonts():
    """Download all fonts as a zip file."""
    fonts = db.get_all_fonts()
    if not fonts:
        return jsonify({"status": "error", "message": "没有可下载的字体"}), 404

    # Create zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for font in fonts:
            file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
            if os.path.exists(file_path):
                zf.write(file_path, font["stored_filename"])
    zip_buffer.seek(0)

    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="FontManager-字体库.zip"
    )


@app.route("/api/fonts/download-family", methods=["GET"])
def download_family_fonts():
    """Download all fonts of a specific family as a zip file."""
    family_name = request.args.get("name", "").strip()
    if not family_name:
        return jsonify({"status": "error", "message": "缺少 name 参数"}), 400

    fonts = db.get_fonts_by_family(family_name)
    if not fonts:
        return jsonify({"status": "error", "message": "未找到字体: {}".format(family_name)}), 404

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for font in fonts:
            file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
            if os.path.exists(file_path):
                zf.write(file_path, font["stored_filename"])
    zip_buffer.seek(0)

    safe_name = re.sub(r'[\\/:*?"<>|]', "_", family_name).strip()
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="{}-全部字重.zip".format(safe_name)
    )


@app.route("/api/fonts/download-selected", methods=["POST"])
def download_selected_fonts():
    """Download selected fonts as a zip file."""
    data = request.get_json()
    font_ids = data.get("ids", [])
    if not font_ids:
        return jsonify({"status": "error", "message": "未选择字体"}), 400

    fonts = [db.get_font_by_id(fid) for fid in font_ids]
    fonts = [f for f in fonts if f is not None]
    if not fonts:
        return jsonify({"status": "error", "message": "未找到字体"}), 404

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for font in fonts:
            file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
            if os.path.exists(file_path):
                zf.write(file_path, font["stored_filename"])
    zip_buffer.seek(0)

    count = len(fonts)
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="FontManager-{}个字体.zip".format(count)
    )


@app.route("/api/tags", methods=["GET"])
def list_tags():
    tags = db.get_all_tags()
    return jsonify({"status": "ok", "tags": tags})


@app.route("/api/tags", methods=["POST"])
def create_tag():
    data = request.get_json()
    name = data.get("name", "").strip()
    color = data.get("color", "#6b7280")
    if not name:
        return jsonify({"status": "error", "message": "Tag name required"}), 400
    try:
        tag_id = db.create_tag(name, color)
        return jsonify({"status": "ok", "tag": {"id": tag_id, "name": name, "color": color, "count": 0}})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/tags/<int:tag_id>", methods=["DELETE"])
def delete_tag(tag_id):
    db.delete_tag(tag_id)
    return jsonify({"status": "ok"})


@app.route("/api/fonts/<int:font_id>/tags", methods=["GET"])
def get_font_tags(font_id):
    tags = db.get_font_tags(font_id)
    return jsonify({"status": "ok", "tags": tags})


@app.route("/api/fonts/<int:font_id>/tags", methods=["POST"])
def add_tag_to_font(font_id):
    data = request.get_json()
    tag_id = data.get("tag_id")
    if not tag_id:
        return jsonify({"status": "error", "message": "tag_id required"}), 400
    db.add_font_tag(font_id, tag_id)
    return jsonify({"status": "ok"})


@app.route("/api/fonts/<int:font_id>/tags/<int:tag_id>", methods=["DELETE"])
def remove_tag_from_font(font_id, tag_id):
    db.remove_font_tag(font_id, tag_id)
    return jsonify({"status": "ok"})


def scan_fonts_directory():
    """Scan FONT_STORAGE on startup: auto-import and rename orphan font files."""
    if not os.path.isdir(FONT_STORAGE):
        return

    # Build set of stored_filenames already in DB
    existing_fonts = db.get_all_fonts()
    db_filenames = {f["stored_filename"] for f in existing_fonts}

    # Also build a set of (family_name, style_name) for dedup
    db_families = {(f["family_name"], f["style_name"]) for f in existing_fonts}

    scanned = 0
    imported = 0
    renamed = 0

    # Scan FONT_STORAGE: both flat files and subdirectories
    all_files = []
    for entry in os.listdir(FONT_STORAGE):
        entry_path = os.path.join(FONT_STORAGE, entry)
        if os.path.isfile(entry_path):
            all_files.append((entry, entry_path))
        elif os.path.isdir(entry_path):
            for sub in os.listdir(entry_path):
                sub_path = os.path.join(entry_path, sub)
                if os.path.isfile(sub_path):
                    all_files.append((sub, sub_path))

    for fname, fpath in all_files:
        ext = os.path.splitext(fname)[1].lower()
        if ext not in (".ttf", ".otf", ".ttc"):
            continue

        scanned += 1

        # Already in DB by stored_filename
        if fname in db_filenames:
            continue

        # Parse the font file
        try:
            meta = parse_font(fpath)
        except Exception as e:
            print("  ⚠️  跳过无法解析的文件: {} ({})".format(fname, e))
            continue

        family_name = meta["family_name"]
        style_name = meta["style_name"]
        fmt = meta["format"]
        backup_path = None  # Will be set if rewrite_font_names is called

        # ── Cmap fingerprint & naming correction (TTF/OTF only) ──
        cmap_fp = None
        if fmt in ("ttf", "otf"):
            cmap_fp = compute_cmap_fingerprint(fpath)
            if cmap_fp:
                raw_name = get_raw_family_name(fpath)
                if raw_name and is_non_standard_naming(raw_name, style_name):
                    base, weight = extract_weight_from_name(raw_name)
                    if base and weight:
                        related = db.get_fonts_by_fingerprint(cmap_fp["hash"])
                        related = [r for r in related
                                   if r.get("cmap_fingerprint")
                                   and json.loads(r["cmap_fingerprint"]).get("glyph_count") == cmap_fp["glyph_count"]
                                   and json.loads(r["cmap_fingerprint"]).get("version") == cmap_fp["version"]]
                        if related:
                            all_names = [r["family_name"] for r in related] + [raw_name]
                            refined = detect_common_base_name(all_names)
                            if refined:
                                base = refined
                        # Backup original file before modification
                        backup_path = _backup_font(fpath, fname)
                        
                        if rewrite_font_names(fpath, base, weight):
                            # Compare glyphs to ensure modification didn't corrupt data
                            if backup_path:
                                cmp = compare_font_glyphs(backup_path, fpath)
                                if not cmp["match"]:
                                    print(f"  ⚠️  字形数据不匹配，自动还原: {cmp['mismatches'][:3]}")
                                    if _restore_font(backup_path, fpath):
                                        # Use original metadata
                                        pass
                                    else:
                                        print("  ❌ 还原失败，跳过此文件")
                                        continue
                            
                            family_name = base
                            style_name = weight
                            meta = parse_font(fpath)
                            print("  🔧 修正命名: {} -> {} - {}".format(fname, family_name, style_name))
                        for r in related:
                            r_fpath = os.path.join(FONT_STORAGE, r["stored_filename"])
                            r_raw = get_raw_family_name(r_fpath) if os.path.exists(r_fpath) else None
                            if r_raw:
                                _, r_weight = extract_weight_from_name(r_raw)
                            else:
                                _, r_weight = "", ""
                            if r_weight:
                                db.replace_font(
                                    r["id"], base, r_weight,
                                    r["format"], r["file_size"], r["file_hash"],
                                    r["stored_filename"], r["original_filename"],
                                    json.loads(r["cjk_info"]) if r.get("cjk_info") else None,
                                    json.loads(r["subfonts_info"]) if r.get("subfonts_info") else None,
                                )

        # Skip Windows built-in fonts
        if is_windows_builtin(family_name):
            print("  ⚠️  跳过 Windows 系统字体: {} ({})".format(family_name, fname))
            continue

        # Check if this family+style already exists in DB
        if (family_name, style_name) in db_families:
            existing = db.get_font_by_family_style(family_name, style_name)
            if existing:
                # Compare completeness
                file_size = os.path.getsize(fpath)
                if _is_more_complete(fmt, file_size, existing["format"], existing["file_size"]):
                    # Remove old file and DB record
                    old_path = os.path.join(FONT_STORAGE, existing["stored_filename"])
                    if os.path.exists(old_path) and old_path != fpath:
                        os.remove(old_path)
                    db.delete_font(existing["id"])
                    db_families.discard((family_name, style_name))
                else:
                    # Old is more complete, skip this file
                    print("  ⚠️  跳过重复文件: {} (已有更完整的版本)".format(fname))
                    continue

        # Determine if family needs subdirectory storage
        family_fonts = db.get_fonts_by_family(family_name)
        use_subdir = len(family_fonts) > 0

        # Generate the correct filename
        ext_no_dot = ext.lstrip(".")
        new_filename = generate_filename(family_name, style_name, ext_no_dot)
        if use_subdir:
            family_dir = os.path.join(FONT_STORAGE, _sanitize_dirname(family_name))
            os.makedirs(family_dir, exist_ok=True)
            new_path = os.path.join(family_dir, new_filename)
        else:
            new_path = os.path.join(FONT_STORAGE, new_filename)

        # Rename if needed (avoid overwriting)
        if fpath != new_path:
            counter = 1
            while os.path.exists(new_path) and new_path != fpath:
                base, ext_part = os.path.splitext(new_filename)
                new_filename = "{}_{}{}".format(base, counter, ext_part)
                new_path = os.path.join(FONT_STORAGE, new_filename)
                counter += 1
            if fpath != new_path:
                os.rename(fpath, new_path)
                renamed += 1

        # Compute metadata
        file_size = os.path.getsize(new_path)
        file_hash = db.compute_file_hash(new_path)

        cjk_info = None
        subfonts_info = None
        if fmt == "ttc":
            cjk_info = get_cjk_support(new_path, font_number=0)
            subfonts_info = get_ttc_subfonts(new_path)
        else:
            cjk_info = get_cjk_support(new_path, font_number=0)

        if use_subdir:
            stored_filename = "{}/{}".format(_sanitize_dirname(family_name), new_filename)
        else:
            stored_filename = new_filename
        db.insert_font(
            family_name=family_name, style_name=style_name, fmt=fmt,
            file_size=file_size, file_hash=file_hash,
            stored_filename=stored_filename, original_filename=fname,
            cjk_info=cjk_info, subfonts_info=subfonts_info,
            cmap_fingerprint=cmap_fp,
            backup_filename=backup_path,
        )
        db_families.add((family_name, style_name))
        imported += 1
        print("  ✅ 入库: {} - {} ({})".format(family_name, style_name, new_filename))

    if scanned > 0:
        print("扫描完成: {} 个文件, 新入库 {} 个, 重命名 {} 个".format(scanned, imported, renamed))




def migrate_flat_to_subdirs():
    """Move existing flat font files into subdirs only for multi-font families."""
    all_fonts = db.get_all_fonts()
    # Count fonts per family
    family_count = {}
    for font in all_fonts:
        fn = font["family_name"]
        family_count[fn] = family_count.get(fn, 0) + 1
    # Only consolidate families with 2+ fonts
    moved = 0
    for family, count in family_count.items():
        if count < 2:
            continue
        _consolidate_family(family)
        moved += 1
    if moved > 0:
        print("迁移完成: {} 个字体家族归入子目录".format(moved))


if __name__ == "__main__":
    args = parse_args()
    FONT_STORAGE = os.path.abspath(args.storage)
    ensure_storage()
    db.init_db()
    db.init_tags_db()
    migrate_flat_to_subdirs()
    print("扫描字体目录: {}".format(FONT_STORAGE))
    scan_fonts_directory()
    print("FontManager starting on http://{}:{}".format(args.host, args.port))
    print("Font storage: {}".format(FONT_STORAGE))
    serve(app, host=args.host, port=args.port)
