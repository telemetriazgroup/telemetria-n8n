#!/usr/bin/env python3
"""Sincroniza code-nodes → workflow_ok.json (delega en build-workflow-ok.py)."""
import subprocess
import sys
from pathlib import Path

script = Path(__file__).resolve().parent / 'build-workflow-ok.py'
sys.exit(subprocess.call([sys.executable, str(script)]))
