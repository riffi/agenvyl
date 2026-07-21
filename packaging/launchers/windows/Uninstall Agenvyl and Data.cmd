@echo off
setlocal
echo This will permanently delete Agenvyl and all user data.
choice /C YN /N /M "Continue? [Y/N] "
if errorlevel 2 exit /b 0
call "%~dp0bin\agenvyl.cmd" uninstall --purge --yes
exit /b %ERRORLEVEL%
