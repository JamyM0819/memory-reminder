@echo off
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo.
echo Starting Memory Reminder server...
echo Open http://localhost:3000 in Chrome on your phone (same WiFi)
echo.
node server.js
pause
