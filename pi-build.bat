@echo off
setlocal

rem SCRIPT_DIR = 当前脚本所在目录（%~dp0 末尾带反斜杠）
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "BUNDLE=%SCRIPT_DIR%\packages\coding-agent\dist\bundle\cli.js"

if not exist "%BUNDLE%" (
	>&2 echo pi is not built: %BUNDLE% not found
	>&2 echo run: npm install --ignore-scripts ^&^& npm run hydrate:model-data ^&^& npm run build:offline
	exit /b 1
)

node "%BUNDLE%" %*
exit /b %ERRORLEVEL%