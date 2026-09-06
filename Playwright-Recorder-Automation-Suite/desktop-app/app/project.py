"""
Project-based workflow: an Automation Project bundles one or more recorded
Scripts (each a list of Steps). Projects are saved/loaded as a single JSON
file with the `.pwproj.json` extension so they are easy to diff and version.
"""
from __future__ import annotations

import json
import os

from .models import Project, Script, Step


def new_project(name: str = "Untitled Project") -> Project:
    return Project(name=name, scripts=[])


def save_project(project: Project, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(project.to_dict(), f, indent=2)
    project.path = path


def load_project(path: str) -> Project:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    project = Project.from_dict(data)
    project.path = path
    return project


def import_recording_file(path: str) -> Script:
    """Import a JSON export from the Chrome extension (session.steps) as a
    new Script. Accepts both the raw `{sessionId, tabInfo, steps}` shape
    exported by the extension and a plain list of step dicts."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        steps = [Step.from_dict(s) for s in data]
        name = os.path.splitext(os.path.basename(path))[0]
    else:
        steps = [Step.from_dict(s) for s in data.get("steps", [])]
        tab_info = data.get("tabInfo") or {}
        name = tab_info.get("title") or os.path.splitext(os.path.basename(path))[0]

    return Script(name=name, steps=steps)
