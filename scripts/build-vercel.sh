#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${AUTOREPORT_ANONYMOUS_CLOUD:-0}" == "1" ]]; then
  exec bash scripts/build-no-email.sh
fi
python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
npm run build
