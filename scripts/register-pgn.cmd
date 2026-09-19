@echo off
rem Associate .pgn with the chessboard.exe sitting next to this file — for the
rem current user only (HKCU, no administrator prompt). Windows has no bundle
rem manifest for this; `native package` (0.8.1) writes no registry entries, so
rem the association is a one-time step the player runs after unzipping. Run
rem unregister to undo:  register-pgn.cmd /u
rem
rem Ships inside the Windows zip next to chessboard.exe (build-windows.yml).
setlocal
set "EXE=%~dp0chessboard.exe"
if "%~1"=="/u" goto :unregister
if not exist "%EXE%" (
  echo chessboard.exe not found next to this script: %EXE%
  exit /b 1
)
reg add "HKCU\Software\Classes\.pgn" /ve /d "Chessboard.pgn" /f >nul
reg add "HKCU\Software\Classes\.pgn" /v "Content Type" /d "application/x-chess-pgn" /f >nul
reg add "HKCU\Software\Classes\Chessboard.pgn" /ve /d "Portable Game Notation" /f >nul
reg add "HKCU\Software\Classes\Chessboard.pgn\DefaultIcon" /ve /d "\"%EXE%\",0" /f >nul
reg add "HKCU\Software\Classes\Chessboard.pgn\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
echo .pgn files now open with %EXE%
exit /b 0

:unregister
reg delete "HKCU\Software\Classes\.pgn" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Chessboard.pgn" /f >nul 2>&1
echo .pgn association removed
exit /b 0
