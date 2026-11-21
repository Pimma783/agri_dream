"""Safety and smoke tests (task 6.6). Plain pytest, no network.

Validates: 14.10, 15.1, 15.3, 15.4, 15.6, 16.9.
"""
from __future__ import annotations

import ast
import hashlib
import io
import json
import re
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_MODULES = ("lot_state", "lot_fixtures", "lot_planning", "lot_service", "webapp", "matching")
MARKUP = "<img src=x onerror=alert(1)>"


def _call(app, method, path, body=None, sid=None):
    raw = json.dumps(body).encode() if body is not None else b""
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "wsgi.input": io.BytesIO(raw),
        "CONTENT_LENGTH": str(len(raw)),
        "wsgi.url_scheme": "http",
    }
    if sid:
        environ["HTTP_COOKIE"] = f"sid={sid}"
    seen: dict = {}

    def start_response(status, headers):
        seen["status"] = int(status.split()[0])
        seen["headers"] = headers

    data = b"".join(app(environ, start_response))
    sid_out = sid
    for name, value in seen["headers"]:
        if name == "Set-Cookie" and value.startswith("sid="):
            sid_out = value.split(";")[0][4:]
    return seen["status"], data, sid_out


def _strings(value):
    """Yield every string (keys and values) in a JSON value."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


# ------------------------------------------------ 14.10 markup stays literal

def test_markup_in_owner_name_stays_literal_in_api_json(monkeypatch, fake_clock):
    import lot_fixtures
    import webapp

    rows = list(lot_fixtures._PLOT_ROWS)
    first = list(rows[0])
    first[2] = MARKUP
    rows[0] = tuple(first)
    monkeypatch.setattr(lot_fixtures, "_PLOT_ROWS", tuple(rows))

    app = webapp.create_app(clock=fake_clock)
    from datetime import timedelta
    delivery = (fake_clock().date() + timedelta(days=4)).isoformat()
    status, data, sid = _call(app, "POST", "/api/orders", {
        "plant_id": "B01", "material": "ฟางข้าว", "target_tons": 10,
        "offer_price": 1500, "max_moisture_pct": 20, "delivery_date": delivery,
    })
    assert status == 201, data
    lot = json.loads(data)["lot"]
    status, data, sid = _call(app, "POST", f"/api/lots/{lot['lot_id']}/proposal",
                              {"revision": lot["revision"]}, sid)
    assert status == 200, data
    body = json.loads(data)
    # The exact string survives: raw bytes carry it with no HTML escaping.
    assert MARKUP in set(_strings(body))
    assert MARKUP.encode() in data
    assert b"&lt;" not in data


def test_markup_in_order_text_is_rejected_or_echoed_literally(fake_clock):
    import webapp

    app = webapp.create_app(clock=fake_clock)
    status, data, _ = _call(app, "POST", "/api/orders", {
        "plant_id": MARKUP, "material": MARKUP, "target_tons": 10,
        "offer_price": 1500, "max_moisture_pct": 20, "delivery_date": MARKUP,
    })
    assert status == 422, data
    body = json.loads(data)
    for text in _strings(body):
        # Any echoed markup must be the exact, unescaped string.
        assert "&lt;" not in text and "&#" not in text


@pytest.mark.parametrize("name", ["web/lot.js", "web/app.js"])
def test_web_scripts_use_no_html_sinks(name):
    source = (ROOT / name).read_text(encoding="utf-8")
    # Comments may mention the sinks to say they are not used. Strip whole-line
    # and trailing `//` comments (no URLs with `//` in code strings are scanned
    # here, since only the sink names matter).
    source = re.sub(r"(?m)(^|\s)//.*$", "", source)
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    sinks = r"\b(innerHTML|outerHTML|insertAdjacentHTML|eval)\b|document\s*\.\s*write(ln)?\b|new\s+Function\b"
    assert re.findall(sinks, source) == []


# --------------------------------------------- 15.3 stdlib-only runtime code

def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0, f"relative import in {path.name}"
            roots.add((node.module or "").split(".")[0])
    return roots


@pytest.mark.parametrize("module", RUNTIME_MODULES)
def test_runtime_module_imports_only_stdlib_or_local(module):
    local = set(RUNTIME_MODULES)
    allowed = set(sys.stdlib_module_names) | local
    roots = _imported_roots(ROOT / f"{module}.py")
    assert roots - allowed == set()


# --------------------------------------------------- 15.1 no AWS, no boto3

def test_app_serves_config_without_aws_env_and_without_boto3_or_strands():
    # Fresh interpreter so earlier imports in this process cannot mask a leak.
    code = textwrap.dedent(
        """
        import io, json, os, sys
        for k in [k for k in os.environ if k.startswith("AWS_")]:
            del os.environ[k]
        os.environ["AWS_CONFIG_FILE"] = os.devnull
        os.environ["AWS_SHARED_CREDENTIALS_FILE"] = os.devnull
        for k in ("AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE"):
            del os.environ[k]
        import webapp
        assert not any(m.split(".")[0] in ("boto3", "botocore", "strands") for m in sys.modules)
        out = {}
        def sr(status, headers): out["status"] = status
        env = {"REQUEST_METHOD": "GET", "PATH_INFO": "/api/config",
               "wsgi.input": io.BytesIO(b""), "CONTENT_LENGTH": "0", "wsgi.url_scheme": "http"}
        body = json.loads(b"".join(webapp.application(env, sr)))
        assert out["status"].startswith("200"), out
        assert "materials" in body and "provinces" in body
        print("OK")
        """
    )
    env = {k: v for k, v in __import__("os").environ.items() if not k.startswith("AWS_")}
    done = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env,
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "OK"


def test_config_endpoint_with_aws_env_removed_in_process(monkeypatch, fake_clock):
    import os
    import webapp

    for key in [k for k in os.environ if k.startswith("AWS_")]:
        monkeypatch.delenv(key)
    status, data, _ = _call(webapp.create_app(clock=fake_clock), "GET", "/api/config")
    assert status == 200
    assert "materials" in json.loads(data)


# -------------------------------- 15.6 no LINE push, payment, carbon claims

# Matched against code with comments and docstrings stripped, so the README
# disclaimers (a Markdown file, not scanned) need no allowlist and a Thai
# disclaimer inside code would not trip it either.
FORBIDDEN_PY = re.compile(
    r"push_message|reply_message|multicast|broadcast|api\.line\.me|"
    r"\bmessaging\b|\bpayments?\b|\bcheckout\b|\binvoice\b|"
    r"carbon_credit|carbon_claim|\bcarbon\b|"
    r"\burllib\b|\brequests\b|\bhttp\.client\b|\bsocket\b",
    re.IGNORECASE,
)
FORBIDDEN_JS = re.compile(
    r"sendMessages|shareTargetPicker|api\.line\.me|push_message|\bpayments?\b|"
    r"carbon_credit|\bcarbon\b",
    re.IGNORECASE,
)


def _code_without_docs(path: Path) -> str:
    """Python source with comments and docstrings removed."""
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body[0] = ast.Pass()
    return ast.unparse(tree)  # unparse drops comments


@pytest.mark.parametrize("module", ["webapp", "lot_state", "lot_fixtures", "lot_planning", "lot_service"])
def test_python_has_no_line_payment_or_carbon_function(module):
    code = _code_without_docs(ROOT / f"{module}.py")
    assert FORBIDDEN_PY.findall(code) == []


@pytest.mark.parametrize("name", ["web/app.js", "web/lot.js"])
def test_scripts_do_not_send_line_messages_or_payments(name):
    source = (ROOT / name).read_text(encoding="utf-8")
    assert FORBIDDEN_JS.findall(source) == []


def test_route_table_has_no_payment_line_or_carbon_path():
    import webapp

    for _method, pattern, _handler in webapp.ROUTES:
        assert not re.search(r"pay|line|carbon|message|push|checkout", pattern.pattern, re.I), pattern.pattern


# --------------------------------------------- 16.9 fixtures are synthetic

def _fixture_text() -> str:
    import lot_fixtures
    import matching

    chunks = [
        (ROOT / "lot_fixtures.py").read_text(encoding="utf-8"),
        (ROOT / "matching.py").read_text(encoding="utf-8"),
    ]
    chunks += [json.dumps(row, ensure_ascii=False, default=str) for row in lot_fixtures._PLOT_ROWS]
    chunks += [json.dumps(row, ensure_ascii=False, default=str) for row in matching.BUYERS.values()]
    return "\n".join(chunks)


def test_fixtures_have_no_phone_like_numbers():
    text = _fixture_text()
    assert re.findall(r"\+66\s*\d", text) == []
    assert re.findall(r"(?<![\d.])0\d{8,9}(?![\d.])", text) == []   # Thai 9-10 digit numbers
    assert re.findall(r"(?<![\d.])\d{9,10}(?![\d.])", text) == []
    assert re.findall(r"\b\d{2,3}-\d{3}-\d{4}\b", text) == []


def test_fixtures_have_no_line_user_ids():
    assert re.findall(r"\bU[0-9a-fA-F]{32}\b", _fixture_text()) == []


def test_fixture_owner_names_are_labeled_mock():
    import lot_fixtures

    for row in lot_fixtures._PLOT_ROWS:
        assert "ตัวอย่าง" in row[2], row[2]
    assert "ตัวอย่าง" in lot_fixtures.CONTRACTOR_NAME


# ------------------------------------------------ 15.4 CLI files unchanged

# Guard against FUTURE edits only. These sha256 values were computed from the
# files as they exist now (task 6.6). They prove nothing about earlier history;
# the workspace is not a git repo. If a deliberate change is made to one of
# these files, update the digest here in the same change.
RECORDED_SHA256 = {
    "matching.py": "e512e6b1f40170ae3f178b1a6de51e0dc4031a5b4e5c17b05b6c0dfc15154186",
    "agent.py": "569826931792313bc7da7095c29f68c8b2f8a1ad6fe41dd0adfe1bf947589a5a",
    "check_bedrock.py": "ac10e040694f07e6042b42eaecb3d964ec2b4e08c358515b29498ed02b924eab",
}


@pytest.mark.parametrize("name", sorted(RECORDED_SHA256))
def test_cli_files_match_recorded_digest(name):
    digest = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    assert digest == RECORDED_SHA256[name]
