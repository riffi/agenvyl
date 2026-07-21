@echo off
setlocal
call "%~dp0bin\agenvyl.cmd" %*
exit /b %ERRORLEVEL%
