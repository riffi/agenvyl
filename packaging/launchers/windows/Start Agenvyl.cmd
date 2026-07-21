@echo off
setlocal
call "%~dp0bin\agenvyl.cmd" start
if errorlevel 1 exit /b %ERRORLEVEL%
if "%AGENVYL_NO_OPEN_BROWSER%"=="1" exit /b 0
if not defined AGENVYL_PORT set "AGENVYL_PORT=8791"
start "" "http://127.0.0.1:%AGENVYL_PORT%"
