@echo off
rem Start OrcaOne. Creates the virtual environment .lenv on first run (or when it is
rem broken) and keeps the dependencies in line with requirements.txt. Pauses on
rem errors so the message stays readable after a double click.
pushd "%~dp0" || exit /b 1
.lenv\Scripts\python.exe -m pip --version >nul 2>nul || (
    where py >nul 2>nul && (py -3 -m venv --clear .lenv) || (python -m venv --clear .lenv)
)
.lenv\Scripts\python.exe -m pip install --quiet --disable-pip-version-check -r requirements.txt || (pause & exit /b 1)
.lenv\Scripts\python.exe -m orcaone %*
if errorlevel 1 pause
