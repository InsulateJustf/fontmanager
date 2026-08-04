@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   FontManager - Build Script
echo ========================================
echo.

cd /d "%~dp0"

REM Create virtual environment if not exists
if not exist "venv" (
    echo [1/4] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment. Is Python installed?
        pause
        exit /b 1
    )
)

REM Activate venv
call venv\Scripts\activate

REM Install dependencies
echo [2/4] Installing dependencies...
pip install -r requirements.txt pyinstaller -q

REM Build exe
echo [3/4] Building FontManager.exe...
pyinstaller fontmanager.spec --clean --noconfirm

REM Check result
if exist "dist\FontManager.exe" (
    echo.
    echo ========================================
    echo   Build successful!
    echo   Output: dist\FontManager.exe
    echo ========================================
    echo.
    echo You can now copy FontManager.exe to any Windows machine
    echo and run it directly (no Python installation needed).
    echo.
    echo Default font storage: C:\ProgramData\FontManager\fonts\
    echo Custom storage: set FONT_STORAGE=D:\MyFonts before running
) else (
    echo.
    echo ERROR: Build failed. Check the output above for errors.
)

pause
