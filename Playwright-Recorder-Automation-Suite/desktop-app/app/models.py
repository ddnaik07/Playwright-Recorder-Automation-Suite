"""
Data model definitions shared across the desktop app.

Mirrors the JSON step schema documented in docs/PROTOCOL.md so that steps
recorded by the Chrome extension can be loaded, edited, executed and
reported on without any translation layer.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Optional


class Action(str, Enum):
    NAVIGATE = "navigate"
    CLICK = "click"
    FILL = "fill"
    SELECT = "select"
    CHECK = "check"
    UNCHECK = "uncheck"
    PRESS = "press"
    HOVER = "hover"
    DRAGDROP = "dragdrop"
    UPLOAD = "upload"
    UPLOAD_CLICK = "upload-click"
    WAIT = "wait"
    ASSERT_TEXT = "assert-text"
    ASSERT_VISIBLE = "assert-visible"


class SelectorType(str, Enum):
    TESTID = "testid"
    ID = "id"
    ROLE = "role"
    CSS = "css"
    XPATH = "xpath"
    NONE = "none"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class WaitFor:
    type: str = "visible"  # visible | networkidle | timeout | none
    timeout: int = 5000

    @staticmethod
    def from_dict(d: Optional[dict]) -> "WaitFor":
        if not d:
            return WaitFor()
        return WaitFor(type=d.get("type", "visible"), timeout=int(d.get("timeout", 5000)))


@dataclass
class Step:
    action: str
    selector: Optional[str] = None
    selectorType: str = SelectorType.NONE.value
    cssEquivalent: Optional[str] = None
    role: Optional[str] = None
    value: Optional[Any] = None
    url: Optional[str] = None
    frameId: int = 0
    timestamp: int = field(default_factory=lambda: int(time.time() * 1000))
    screenshot: Optional[str] = None
    waitFor: dict = field(default_factory=lambda: asdict(WaitFor()))
    meta: Optional[dict] = None
    id: str = field(default_factory=lambda: str(uuid.uuid4()))

    @staticmethod
    def from_dict(d: dict) -> "Step":
        known = {k: d.get(k) for k in Step.__dataclass_fields__.keys() if k in d}
        step = Step(action=d.get("action", "click"))
        for k, v in known.items():
            setattr(step, k, v)
        if not step.waitFor:
            step.waitFor = asdict(WaitFor())
        if step.selectorType is None:
            step.selectorType = SelectorType.NONE.value
        if not step.id:
            step.id = str(uuid.uuid4())
        return step

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StepResult:
    step: Step
    status: str = StepStatus.PENDING.value
    error: Optional[str] = None
    screenshotPath: Optional[str] = None
    tracePath: Optional[str] = None
    durationMs: int = 0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["step"] = self.step.to_dict()
        return d


@dataclass
class RunResult:
    runId: str = field(default_factory=lambda: str(uuid.uuid4()))
    startedAt: int = field(default_factory=lambda: int(time.time() * 1000))
    endedAt: int = 0
    steps: list = field(default_factory=list)  # list[StepResult]

    @property
    def durationMs(self) -> int:
        return max(0, self.endedAt - self.startedAt)

    def counts(self) -> dict:
        counts = {s.value: 0 for s in StepStatus}
        for sr in self.steps:
            counts[sr.status] = counts.get(sr.status, 0) + 1
        return counts

    def to_dict(self) -> dict:
        return {
            "runId": self.runId,
            "startedAt": self.startedAt,
            "endedAt": self.endedAt,
            "durationMs": self.durationMs,
            "steps": [s.to_dict() for s in self.steps],
            "counts": self.counts(),
        }


@dataclass
class Script:
    name: str
    steps: list = field(default_factory=list)  # list[Step]

    def to_dict(self) -> dict:
        return {"name": self.name, "steps": [s.to_dict() for s in self.steps]}

    @staticmethod
    def from_dict(d: dict) -> "Script":
        return Script(name=d.get("name", "Untitled"), steps=[Step.from_dict(s) for s in d.get("steps", [])])


@dataclass
class Project:
    name: str = "Untitled Project"
    createdAt: int = field(default_factory=lambda: int(time.time() * 1000))
    scripts: list = field(default_factory=list)  # list[Script]
    path: Optional[str] = None  # filesystem path once saved

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "createdAt": self.createdAt,
            "scripts": [s.to_dict() for s in self.scripts],
        }

    @staticmethod
    def from_dict(d: dict) -> "Project":
        return Project(
            name=d.get("name", "Untitled Project"),
            createdAt=d.get("createdAt", int(time.time() * 1000)),
            scripts=[Script.from_dict(s) for s in d.get("scripts", [])],
        )
