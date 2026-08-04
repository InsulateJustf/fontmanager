"""FontManager — Flask web application for font management."""

import io
import os
import shutil
import tempfile
import argparse
from flask import Flask, request, jsonify, send_from_directory, send_file
from waitress import serve

import db
from font_parser import parse_font, generate_filename, detect_format, get_ttc_subfonts

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8080
DEFAULT_STORAGE_WINDOWS = r"C:\ProgramData\FontManager\fonts"

FONT_STORAGE = None
app = Flask(__name__, static_folder="static")


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

        if db.font_exists(family_name, style_name):
            return {"filename": original_name, "status": "duplicate",
                    "message": "Font already exists: {} - {}".format(family_name, style_name),
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

        font_id = db.insert_font(
            family_name=family_name, style_name=style_name, fmt=fmt,
            file_size=file_size, file_hash=file_hash,
            stored_filename=new_filename, original_filename=original_name,
        )

        return {"filename": original_name, "status": "success",
                "message": "Added: {} - {}".format(family_name, style_name),
                "font_id": font_id, "family_name": family_name,
                "style_name": style_name, "stored_filename": new_filename}

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
    """Serve font file for preview (inline) or download."""
    font = db.get_font_by_id(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404

    file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": "Font file missing"}), 404

    # ?download=1 triggers attachment download
    as_download = request.args.get("download") == "1"
    if as_download:
        download_name = font["original_filename"]
        return send_file(file_path, as_attachment=True, download_name=download_name)

    # ?subfont=N serves a specific sub-font from TTC as standalone TTF
    subfont_index = request.args.get("subfont")
    if subfont_index is not None and font["format"] == "ttc":
        try:
            subfont_index = int(subfont_index)
        except ValueError:
            return jsonify({"status": "error", "message": "Invalid subfont index"}), 400

        from fontTools.ttLib import TTCollection
        try:
            ttc = TTCollection(file_path)
            if subfont_index < 0 or subfont_index >= len(ttc):
                return jsonify({"status": "error",
                                "message": "Subfont index out of range (0-{})".format(len(ttc) - 1)}), 400

            buf = io.BytesIO()
            font_obj = ttc[subfont_index]
            font_obj.save(buf)
            buf.seek(0)
            ttc.close()
            return send_file(buf, mimetype="font/ttf")
        except Exception as e:
            return jsonify({"status": "error",
                            "message": "Failed to extract subfont: {}".format(e)}), 500

    # Otherwise serve inline (for @font-face preview)
    mime_map = {"ttf": "font/ttf", "otf": "font/otf", "ttc": "font/collection"}
    mime = mime_map.get(font["format"], "application/octet-stream")
    return send_file(file_path, mimetype=mime)


@app.route("/api/fonts/<int:font_id>/subfonts", methods=["GET"])
def list_subfonts(font_id):
    """List sub-fonts in a TTC file."""
    font = db.get_font_by_id(font_id)
    if font is None:
        return jsonify({"status": "error", "message": "Font not found"}), 404

    if font["format"] != "ttc":
        return jsonify({"status": "ok", "subfonts": [
            {"index": 0, "family_name": font["family_name"], "style_name": font["style_name"]}
        ]})

    file_path = os.path.join(FONT_STORAGE, font["stored_filename"])
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": "Font file missing"}), 404

    try:
        subfonts = get_ttc_subfonts(file_path)
        return jsonify({"status": "ok", "subfonts": subfonts})
    except Exception as e:
        return jsonify({"status": "error",
                        "message": "Failed to read TTC: {}".format(e)}), 500


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
