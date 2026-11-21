"""Shared pytest fixtures."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

# Deterministic start so tests never depend on the real clock.
FAKE_CLOCK_START = datetime(2025, 1, 1, 8, 0, 0, tzinfo=timezone.utc)


class FakeClock:
    """Callable clock returning a controllable datetime."""

    def __init__(self, start: datetime = FAKE_CLOCK_START) -> None:
        self.now = start

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> datetime:
        """Move time forward (timedelta keyword arguments) and return it."""
        self.now = self.now + timedelta(**kwargs)
        return self.now

    def set(self, value: datetime) -> None:
        self.now = value


@pytest.fixture
def fake_clock() -> FakeClock:
    return FakeClock()
