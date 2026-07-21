@echo off
setlocal
call "%~dp0bin\agenvyl.cmd" status
exit /b %ERRORLEVEL%
