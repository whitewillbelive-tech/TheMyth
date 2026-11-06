#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_python=python3
if [[ -x .venv/bin/python ]]; then task_python=.venv/bin/python; fi
"$task_python" -m unittest discover -s tests -v
node --check web/app.js
