@echo off
setlocal
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\python.exe"
set "WAIT=%SystemRoot%\System32\timeout.exe"
if not exist "%PY%" (
  echo [ERROR] Python venv not found: %PY%
  echo Install dependencies first:
  echo   .venv\Scripts\pip.exe install -r requirements.txt -r requirements-server.txt
  pause
  exit /b 1
)

if not exist "%~dp0web\dist\index.html" (
  echo Building frontend for the first run...
  pushd "%~dp0web"
  if not exist node_modules call npm install
  call npm run build
  popd
)

if not exist "%~dp0web\dist\index.html" (
  echo [ERROR] Frontend build failed. Install Node.js and retry.
  pause
  exit /b 1
)

echo Syncing data snapshot from local database...
"%PY%" "%~dp0tools\build_web_db.py"
if errorlevel 1 echo [WARN] Snapshot rebuild failed; using existing snapshot.

echo Starting local control service...
start "CCUS Console Server (close this window to stop)" cmd /k "%PY%" -m uvicorn server.app:app --host 127.0.0.1 --port 8765
"%WAIT%" /t 3 /nobreak >nul
start "" http://127.0.0.1:8765/
echo Opened http://127.0.0.1:8765/ in your browser.
echo Close the server window to stop the service.
"%WAIT%" /t 4 /nobreak >nul
