@echo off
setlocal
for %%I in ("%~dp0..") do set "AGENVYL_BUNDLE_ROOT=%%~fI"
set "AGENVYL_APP_ROOT=%AGENVYL_BUNDLE_ROOT%\app"
set "AGENVYL_NODE_EXECUTABLE=%AGENVYL_BUNDLE_ROOT%\runtime\node.exe"
if not defined AGENVYL_POSTGRES_ROOT set "AGENVYL_POSTGRES_ROOT=%AGENVYL_BUNDLE_ROOT%\postgres"
"%AGENVYL_NODE_EXECUTABLE%" "%AGENVYL_APP_ROOT%\packages\supervisor\dist\cli.js" %*
exit /b %ERRORLEVEL%
