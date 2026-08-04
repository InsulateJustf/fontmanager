@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   FontManager - 字体管理系统
echo ========================================
echo.

cd /d "%~dp0"

REM Create virtual environment if not exists
if not exist "venv" (
    echo [1/3] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment. Is Python installed and in PATH?
        pause
        exit /b 1
    )
)

REM Activate venv
call venv\Scripts\activate

REM Install dependencies
echo [2/3] Installing dependencies...
pip install -r requirements.txt -q

REM Start server
echo [3/3] Starting FontManager...
echo.
echo ========================================
echo   Server running at: http://localhost:8080
echo   Press Ctrl+C to stop
echo ========================================
echo.

python app.py

pause
