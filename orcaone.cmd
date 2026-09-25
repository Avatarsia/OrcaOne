@echo off
rem Start OrcaOne. Creates the virtual environment .wenv on first run (or when it is
rem broken) and keeps the dependencies in line with requirements.txt. Pauses on
rem errors so the message stays readable after a double click. Not .lenv as in
rem orcaone.sh, so a folder used from Linux and Windows keeps both.
setlocal
pushd "%~dp0" || exit /b 1
rem Python 3.11 or newer, but no free-threaded build like python3.13t: cffi, which paramiko
rem needs, does not build there. "py -3" picks 3.13t first when it is installed, so every
rem version "py -0" lists is tried in turn, then python from PATH.
set "CHECK=import sys, sysconfig; sys.exit(sys.version_info < (3, 11) or bool(sysconfig.get_config_var('Py_GIL_DISABLED')))"
.wenv\Scripts\python.exe -c "%CHECK%" >nul 2>nul && .wenv\Scripts\python.exe -m pip --version >nul 2>nul && goto install
set "PYTHON="
for /f "tokens=1" %%v in ('py -0 2^>nul') do if not defined PYTHON py %%v -c "%CHECK%" >nul 2>nul && set "PYTHON=py %%v"
if not defined PYTHON python -c "%CHECK%" >nul 2>nul && set "PYTHON=python"
if not defined PYTHON (echo OrcaOne braucht Python ab 3.11, nicht free-threaded: https://www.python.org/downloads/ & pause & exit /b 1)
echo Richte die Python-Umgebung .wenv ein, mit %PYTHON% ...
%PYTHON% -m venv --clear .wenv || (pause & exit /b 1)
:install
rem pip runs only when requirements.txt differs from the copy of the last install, so the
rem console shows an install in full and a normal start stays quiet and quick.
fc /b requirements.txt .wenv\requirements.txt >nul 2>nul && goto run
echo Installiere die Pakete aus requirements.txt ...
.wenv\Scripts\python.exe -m pip install --disable-pip-version-check -r requirements.txt || (pause & exit /b 1)
copy /y requirements.txt .wenv\requirements.txt >nul
:run
.wenv\Scripts\python.exe -m orcaone %*
if errorlevel 1 pause
