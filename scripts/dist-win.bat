@echo off
rem ============================================================
rem DSH Buddy - Windows packaging entry (double-click friendly).
rem Use this for local builds; do NOT run "npm run dist:win"
rem directly from an IDE terminal: Electron-based IDEs (Qoder,
rem VSCode, ...) inject ELECTRON_RUN_AS_NODE etc. which turn every
rem spawned electron.exe into a plain Node process.
rem
rem All real logic lives in scripts\dist-win.ps1: env stripping,
rem dist lock probe, single-line progress bar with percentage,
rem and the press-any-key + open-output-folder finish flow.
rem (Comments stay ASCII: cmd parses .bat as OEM/GBK, UTF-8 CJK
rem comments corrupt parsing.)
rem ============================================================
setlocal
title DSH Buddy Windows Packaging
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dist-win.ps1" %*
exit /b %errorlevel%
