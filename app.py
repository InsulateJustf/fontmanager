"""FontManager — Flask web application for font management."""

import os
import shutil
import sys
import tempfile
import argparse
from flask import Flask, request, jsonify, send_from_directory
from waitress import serve

import db
from font_parser import parse_font, generate_filename, detect_format

# Defaults
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080
DEFAULT_STORAGE_WINDOWS = r"C:\ProgramData\FontManager\fonts"


def get_default_storage():
    """Get default font storage path based on OS."""
    if os.name == "nt":
        return DEFAULT_STORAGE_WINDOWS
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")


# Will be set by parse_args()
FONT_STORAGE = None

app = Flask(__name__, static_folder="static")


# ─── Initialization ───────────────────────────────────────────────────────────

def ensure_storage():
    """Create font storage directory if it doesn't exist."""
    os.makedirs(FONT_STORAGE, exist_ok=True)


# ─── Static files ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ─── API: Upload ──────────────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
def upload_font():
    """Handle font file upload(s)."""
    if "files" not in request.files:
        return jsonify({"status": "error", "message": "No files provided"}), 400

    files = request.files.getlist("files")
    results = []

    for f in files:
        if not f.filename:
            results.append({"filename": "(empty)", "status": "error", "message": "Empty filename"})
            continue

        result = _process_single_file(f)
        results.append(result)

    return jsonify({"status": "ok", "results": results})


def _process_single_file(file_storage):
    """Process a single uploaded file."""
    original_name = file_storage.filename
    ext = os.path.splitext(original_name)[1].lower()

    if detect_format(original_name) is None:
        return {
            "filename": original_name,
            "status": "error",
            "message": f"Unsupported format: {ext}",
        }

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext)
    try:
        file_storage.save(tmp_path)
        os.close(tmp_fd)

        meta = parse_font(tmp_path)
        family_name = meta["family_name"]
        style_name = meta["style_name"]
        fmt = meta["format"]

        if db.font_exists(family_name, style_name):
            return {
                "filename": original_name,
                "status": "duplicate",
                "message": f"Font already exists: {family_name} - {style_name}",
                "family_name": family_name,
                "style_name": style_name,
            }

        new_filename = generate_filename(family_name, style_name, ext.lstrip("."))
        dest_path = os.path.join(FONT_STORAGE, new_filename)

        counter = 1
        while os.path.exists(dest_path):
            base, ext_part = os.path.splitext(new_filename)
            new_filename = f"{base}_{counter}{ext_part}"
            dest_path = os.path.join(FONT_STORAGE, new_filename)
            counter += 1

        shutil.move(tmp_path, dest_path)
        tmp_fd = -1

        file_size = os.path.getsize(dest_path)
        file_hash = db.compute_file_hash(dest_path)

        font_id = db.insert_font(
            family_name=family_name,
            style_name=style_name,
            fmt=fmt,
            file_size=file_size,
            file_hash=file_hash,
            stored_filename=new_filename,
            original_filename=original_name,
        )

        return {
            "filename": original_name,
            "status": "success",
            "message": f"Added: {family_name} - {style_name}",
            "font_id": font_id,
            "family_name": family_name,
            "style_name": style_name,
            "stored_filename": new_filename,
        }

    except ValueError as e:
        return {"filename": original_name, "status": "error", "message": str(e)}
    except Exception as e:
        return {"filename": original_name, "status": "error", "message": f"Unexpected error: {e}"}
    finally:
        if tmp_fd >= 0:
            os.close(tmp_fd)
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


# ─── API: Font list ───────────────────────────────────────────────────────────

@app.route("/api/fonts", methods=["GET"])
def list_fonts():
    fonts = db.get_all_fonts()
    return jsonify({"status": "ok", "fonts": fonts})


# ─── API: Delete font ─────────────────────────────────────────────────────────

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
            return jsonify({"status": "warning", "message": f"Record deleted but file removal failed: {e}"})

    return jsonify({"status": "ok", "message": f"Deleted: {font['family_name']} - {font['style_name']}"})


# ─── CLI ──────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="FontManager — Web-based font management")
    parser.add_argument(
        "-s", "--storage",
        default=os.environ.get("FONT_STORAGE", get_default_storage()),
        help="Font storage directory (default: %(default)s)",
    )
    parser.add_argument(
        "-p", "--port",
        type=int,
        default=int(os.environ.get("FONT_PORT", DEFAULT_PORT)),
        help="Server port (default: %(default)s)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("FONT_HOST", DEFAULT_HOST),
        help="Server host (default: %(default)s)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    FONT_STORAGE = os.path.abspath(args.storage)

    ensure_storage()
    db.init_db()

    print(f"FontManager starting on http://{args.host}:{args.port}")
    print(f"Font storage: {FONT_STORAGE}")
    serve(app, host=args.host, port=args.port)
