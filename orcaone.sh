#!/bin/sh
# Start OrcaOne. Creates the virtual environment .lenv on first run (or when it is
# broken, e.g. after a Python upgrade) and keeps the dependencies in line with
# requirements.txt.
set -e
cd "$(dirname "$0")"
if ! .lenv/bin/python -m pip --version >/dev/null 2>&1; then
    python3 -m venv --clear .lenv
fi
.lenv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt
exec .lenv/bin/python -m orcaone "$@"
