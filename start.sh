#!/bin/bash
# FontManager — macOS 开发/调试启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 参数解析 ────────────────────────────────────────────────────────────────

PORT="8080"
STORAGE="./fonts"

usage() {
    echo "Usage: $0 [-s storage_dir] [-p port]"
    echo ""
    echo "Options:"
    echo "  -s, --storage DIR   字体存储目录 (默认: ./fonts)"
    echo "  -p, --port PORT     服务端口 (默认: 8080)"
    echo "  -h, --help          显示帮助"
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--storage) STORAGE="$2"; shift 2 ;;
        -p|--port) PORT="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# ─── 虚拟环境 ────────────────────────────────────────────────────────────────

if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate

# ─── 依赖安装 ────────────────────────────────────────────────────────────────

echo "📦 Checking dependencies..."
pip install -r requirements.txt -q

# ─── 启动服务 ────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         🔤 FontManager                   ║"
echo "╠══════════════════════════════════════════╣"
echo "║  URL: http://localhost:${PORT}             ║"
echo "║  Storage: ${STORAGE}                       "
echo "╚══════════════════════════════════════════╝"
echo ""

exec python3 app.py --port "$PORT" --storage "$STORAGE"
