@echo off
echo ORO CRM — starter opp...
echo.

cd /d "%~dp0"

:: Slett halvferdig node_modules hvis den finnes
if exist node_modules (
  echo Rydder gammel installasjon...
  rmdir /s /q node_modules
)

echo Installerer pakker (tar 1-2 min forste gang)...
call npm install
if errorlevel 1 (
  echo.
  echo Feil under npm install. Kontakt support.
  pause
  exit /b 1
)

echo.
echo Importerer data fra Excel...
call node seed.js
if errorlevel 1 (
  echo.
  echo Feil under seed. Sjekk at ORO Investorer Master.xlsx ligger i mappen over.
  pause
  exit /b 1
)

echo.
echo Starter API-server i eget vindu...
start "ORO API-server" cmd /k "cd /d "%~dp0" && node server.js"

echo Venter 2 sekunder pa at API skal starte...
timeout /t 2 /nobreak > nul

echo.
echo =============================================
echo  Apne http://localhost:5173 i nettleseren
echo  Lukk dette vinduet for aa stoppe Vite
echo =============================================
echo.
call npx --yes vite
pause
