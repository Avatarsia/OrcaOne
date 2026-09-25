"""Builds OrcaOne into a folder that runs without Python and without .lenv, with PyInstaller:
dist/OrcaOne/OrcaOne on Linux and macOS, dist\\OrcaOne\\OrcaOne.exe on Windows. PyInstaller only
builds for the system it runs on. Steps in docs/STARTEN-UND-BAUEN.md.

    .lenv/bin/python -m pip install pyinstaller
    .lenv/bin/python tools/build.py
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    try:
        import PyInstaller.__main__
    except ImportError:
        sys.exit("PyInstaller fehlt. Einmal installieren: python -m pip install pyinstaller")
    work = ROOT / "build"
    work.mkdir(exist_ok=True)
    # PyInstaller needs a script; orcaone/__main__.py uses relative imports and cannot be one.
    launcher = work / "OrcaOne.py"
    launcher.write_text("from orcaone.__main__ import main\n\nmain()\n", encoding="utf-8")
    PyInstaller.__main__.run([
        str(launcher), "--name", "OrcaOne", "--onedir", "--noconfirm", "--clean",
        "--paths", str(ROOT), "--distpath", str(ROOT / "dist"), "--workpath", str(work), "--specpath", str(work),
        # The page and the option lists the transfer needs; os.pathsep is ";" on Windows, ":" elsewhere.
        "--add-data", f"{ROOT / 'orcaone' / 'static'}{os.pathsep}orcaone/static",
        "--add-data", f"{ROOT / 'orcaone' / 'options.json'}{os.pathsep}orcaone",
        # The licence goes with every copy (PolyForm, "Notices").
        "--add-data", f"{ROOT / 'LICENSE.md'}{os.pathsep}.",
        # uvicorn picks its event loop and protocols by name at run time.
        "--collect-submodules", "uvicorn",
        # OrcaOne's icon for the program file; only Windows keeps it there (tools/make_icons.py).
        *(["--icon", str(ROOT / "orcaone" / "static" / "assets" / "app-icon.ico")] if os.name == "nt" else []),
    ])
    print(f"\nFertig: {ROOT / 'dist' / 'OrcaOne'}")


if __name__ == "__main__":
    main()
