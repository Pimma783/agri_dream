---
inclusion: always
---
# Project structure

- `docs/submission.md` holds the submitted idea and decision log.
- `docs/handoff.md` records the latest working decisions and next step.
- `.kiro/steering/` holds product, technology, structure, and AWS rules.
- Root `agent.py`, `check_bedrock.py`, and `pyproject.toml` are the bootcamp scaffold.

Proposed layout (assumption): add `apps/web/` for LIFF/web, `apps/api/` for HTTP and LINE integration, `matching/` for Python business logic, and `tests/` for matching and integration tests. Add each directory when the first feature needs it.

Use snake_case for Python files and keep the F1–F10 identifiers from the submission in specs and tests (assumption).
