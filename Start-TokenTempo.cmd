@echo off
setlocal
chcp 65001 >nul
title TokenTempo - Work and Codex reply speed
cd /d "%~dp0"
mode con cols=116 lines=36 >nul 2>&1
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0src\cli.mjs" %*
) else (
  where node.exe >nul 2>&1
  if errorlevel 1 (
    echo Node.js was not found. Download the Windows portable ZIP from Releases.
    echo The portable ZIP includes its own runtime. Extract ALL files before starting.
    pause
    exit /b 1
  )
  node.exe "%~dp0src\cli.mjs" %*
)
if errorlevel 1 (
  echo.
  echo TokenTempo stopped with an error. Keep this window open for diagnosis.
  pause
)
endlocal
