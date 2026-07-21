@echo off
setlocal
call "%~dp0bin\agenvyl.cmd" uninstall
exit /b %ERRORLEVEL%
