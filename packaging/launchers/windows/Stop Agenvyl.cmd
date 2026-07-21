@echo off
setlocal
call "%~dp0bin\agenvyl.cmd" stop
exit /b %ERRORLEVEL%
