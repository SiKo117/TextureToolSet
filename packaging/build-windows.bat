@echo off
REM ==============================================================================
REM RGBA Channel Packer - Windows CMD Build Script (Electron + Bun)
REM ==============================================================================

echo 🚀 Starting RGBA Channel Packer Windows CMD Build Pipeline (Electron + Bun)...

cd /d "%~dp0\.."

echo 🍞 Running Bun install...
call bun install

echo 🛠️ Building Windows App with Electron & Bun...
call bun run build:win

echo.
echo ==============================================================================
echo 🎉 Build Complete! Output packages located at:
echo   • dist\RGBA Channel Packer Setup 1.0.0.exe (NSIS Installer)
echo   • dist\RGBA Channel Packer 1.0.0.exe       (Portable EXE)
echo ==============================================================================
pause
