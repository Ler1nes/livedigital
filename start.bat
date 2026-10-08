@echo off
cd /d "%~dp0"
if not exist ".\css" (
  echo Run this file from the Livedigital project folder.
  pause
  exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Install Python 3 and try again.
  pause
  exit /b 1
)
start "LiveRoom server" /min python -m http.server 8000
timeout /t 1 /nobreak >nul
start "" "http://localhost:8000"
