@echo off
echo ORO CRM starter...
echo.

cd /d "%~dp0"

:: Starter API-server i eget vindu
start "ORO API-server" cmd /k "cd /d "%~dp0" && node server.js"

:: Kort pause
timeout /t 2 /nobreak > nul

echo =============================================
echo  Apne http://localhost:5173 i nettleseren
echo  Lukk dette vinduet for aa stoppe
echo =============================================
echo.
call npx vite
pause
