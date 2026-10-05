@echo off
setlocal
rem Prefer Windows Terminal for CJK font fallback. Explicit CLI args stay in the current terminal.
if "%~1"=="" if not defined WT_SESSION if not defined TOKEN_TEMPO_NO_WT (
  where wt.exe >nul 2>&1
  if not errorlevel 1 (
    wt.exe -w new new-tab --title TokenTempo cmd.exe /d /c ""%~f0" --lang zh"
    if not errorlevel 1 exit /b 0
  )
)
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
