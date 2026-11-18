@echo off
title Prospect Finder - Create Desktop Shortcut
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0App\create-shortcuts.ps1"
if errorlevel 1 (
  echo.
  echo  Something went wrong - see the message above.
)
pause
