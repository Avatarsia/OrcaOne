@echo off
rem Start Orfix. Creates the virtual environment .lenv on first run and keeps the
rem dependencies in line with requirements.txt.
cd /d "%~dp0"
if not exist .lenv\Scripts\python.exe (
    where py >nul 2>nul && (py -3 -m venv .lenv) || (python -m venv .lenv)
)
.lenv\Scripts\python.exe -m pip install --quiet --disable-pip-version-check -r requirements.txt || exit /b 1
.lenv\Scripts\python.exe -m orfix %*
