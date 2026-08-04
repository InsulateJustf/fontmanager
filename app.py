"""FontManager — Flask web application for font management."""

import io
import json
import os
import shutil
import tempfile
import argparse
from flask import Flask, request, jsonify, send_from_directory, send_file
from waitress import serve

import db
from font_parser import (parse_font, generate_filename, detect_format,
                         get_ttc_subfonts, get_cjk_support)

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
        dest_path = os.path.join(FONT_STORAGE, new_filename)
        counter = 1
        while os.path.exists(dest_path):
            base, ext_part = os.path.splitext(new_filename)
            new_filename = "{}_{}{}".format(base, counter, ext_part)
            dest_path = os.path.join(FONT_STORAGE, new_filename)
            counter += 1

        shutil.move(tmp_path, dest_path)
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
            stored_filename=new_filename, original_filename=original_name,
            cjk_info=cjk_info, subfonts_info=subfonts_info,
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


if __name__ == "__main__":
    args = parse_args()
    FONT_STORAGE = os.path.abspath(args.storage)
    ensure_storage()
    db.init_db()
    print("FontManager starting on http://{}:{}".format(args.host, args.port))
    print("Font storage: {}".format(FONT_STORAGE))
    serve(app, host=args.host, port=args.port)
