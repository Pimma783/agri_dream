---
inclusion: always
---
# Technical direction

The current Python 3.12+ workspace is the bootcamp scaffold. `agent.py` uses Strands and still demonstrates PostPal. `check_bedrock.py` probes Bedrock. Follow the AWS rules in `aws.md`.

- Planned application architecture from the submission: Next.js and LINE LIFF/Bot, REST API with Node.js/Express and JWT, Python matching logic, PostgreSQL/PostGIS, image storage and Redis.
- Start image grading with rules. Labeled training data is unavailable, so the CNN described in the architecture is a later option.
- Validate buyer participation, routing cost, and the real savings from aggregation during the pilot. Treat them as assumptions until measured.
- Bootcamp commands from the current scaffold: `uv run agent.py` and `uv run check_bedrock.py`. The project declares Strands in `pyproject.toml`; the Bedrock probe also imports boto3.
- This team folder has no configured test suite yet. The separate PostPal playground suite runs with `uv run --locked pytest -q`.
- Keep real personal data out of prototype fixtures (assumption pending team privacy policy).
