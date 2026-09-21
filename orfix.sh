#!/bin/sh
# Start Orfix. Creates the virtual environment .lenv on first run and keeps the
# dependencies in line with requirements.txt.
set -e
cd "$(dirname "$0")"
if [ ! -x .lenv/bin/python ]; then
    python3 -m venv .lenv
fi
.lenv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt
exec .lenv/bin/python -m orfix "$@"
