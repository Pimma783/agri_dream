# Feature: straw-lot-planning-demo, Property 2: Invalid search input yields one error per invalid field
"""POST /api/matches validation, driven through webapp.application directly.

**Validates: Requirements 2.1**
"""
import io
import json
import math

from hypothesis import given, settings, strategies as st

import webapp
from matching import MATERIALS, PILOT_PROVINCES

MISSING = object()  # field omitted from the body
FIELDS = ("material", "quantity_tons", "province")
BAD_BODY = "ข้อมูลค้นหาไม่ถูกต้อง"
SETTINGS = settings(max_examples=100, deadline=None)


def call(body: bytes | None, content_length=None):
    """Run one POST /api/matches through the WSGI app. Returns (code, headers, json)."""
    if content_length is None:
        content_length = "" if body is None else str(len(body))
    environ = {
        "REQUEST_METHOD": "POST",
        "PATH_INFO": "/api/matches",
        "CONTENT_LENGTH": content_length,
        "wsgi.input": io.BytesIO(body or b""),
        "wsgi.url_scheme": "http",
    }
    captured = {}

    def start_response(status, headers):
        captured["status"] = status
        captured["headers"] = headers

    payload = b"".join(webapp.application(environ, start_response))
    return int(captured["status"].split()[0]), captured["headers"], json.loads(payload)


def post(fields: dict):
    body = {k: v for k, v in fields.items() if v is not MISSING}
    return call(json.dumps(body).encode())  # NaN and Infinity serialize as JS literals


def assert_no_cookie(headers):
    assert not [h for h in headers if h[0].lower() == "set-cookie"]


# ------------------------------------------------------------ strategies

valid_material = st.sampled_from(sorted(MATERIALS))
valid_province = st.sampled_from(sorted(PILOT_PROVINCES))
valid_quantity = st.one_of(
    st.integers(min_value=1, max_value=10**6),
    st.floats(min_value=1e-6, max_value=1e9, allow_nan=False, allow_infinity=False),
)

junk = st.one_of(
    st.booleans(),
    st.none(),
    st.integers(min_value=-10**6, max_value=10**6),
    st.lists(st.integers(), max_size=3),
    st.dictionaries(st.text(max_size=5), st.integers(), max_size=2),
)
invalid_material = st.one_of(
    st.just(MISSING),
    junk,
    st.text(max_size=40).filter(lambda s: s not in MATERIALS),
)
invalid_province = st.one_of(
    st.just(MISSING),
    junk,
    st.text(max_size=40).filter(lambda s: s not in PILOT_PROVINCES),
)
invalid_quantity = st.one_of(
    st.just(MISSING),
    st.booleans(),
    st.none(),
    st.text(max_size=20),  # numeric-looking strings are still strings
    st.just("5"),
    st.lists(st.integers(), max_size=3),
    st.integers(max_value=0, min_value=-10**9),
    st.floats(max_value=0, allow_nan=False, allow_infinity=False),
    st.sampled_from([float("nan"), float("inf"), float("-inf"), 0.0, -0.0]),
    st.integers(min_value=10**400, max_value=10**402),  # overflows float()
    st.integers(min_value=-10**402, max_value=-10**400),
)


@st.composite
def search_bodies(draw):
    """Each field valid or invalid; at least one invalid. Returns (fields, invalid_names)."""
    flags = draw(st.tuples(st.booleans(), st.booleans(), st.booleans()).filter(any))
    fields = {
        "material": draw(invalid_material if flags[0] else valid_material),
        "quantity_tons": draw(invalid_quantity if flags[1] else valid_quantity),
        "province": draw(invalid_province if flags[2] else valid_province),
    }
    return fields, {name for name, bad in zip(FIELDS, flags) if bad}


# ------------------------------------------------------------ properties

@SETTINGS
@given(search_bodies())
def test_invalid_fields_yield_422_with_exactly_those_errors(case):
    fields, invalid = case
    code, headers, body = post(fields)
    assert code == 422
    assert set(body["errors"]) == invalid
    for message in body["errors"].values():
        assert isinstance(message, str) and message.strip()
        assert any("\u0e00" <= ch <= "\u0e7f" for ch in message)  # Thai text
    assert "matches" not in body
    assert_no_cookie(headers)


@SETTINGS
@given(valid_material, valid_quantity, valid_province)
def test_valid_input_yields_200_with_matches(material, quantity, province):
    code, headers, body = post(
        {"material": material, "quantity_tons": quantity, "province": province})
    assert code == 200
    assert "errors" not in body and isinstance(body["matches"], list)
    assert math.isfinite(body["quantity_tons"]) and body["quantity_tons"] > 0
    assert_no_cookie(headers)


def assert_bad_body(result):
    code, headers, body = result
    assert code == 400
    assert body == {"message": BAD_BODY}
    assert_no_cookie(headers)


@SETTINGS
@given(st.sampled_from([None, "", "0", "abc"]))
def test_missing_body_is_400(length):
    assert_bad_body(call(None, content_length=length))


@SETTINGS
@given(st.integers(min_value=0, max_value=3000))
def test_body_over_4096_bytes_is_400(extra):
    body = json.dumps({"material": "ฟางข้าว", "pad": "x" * (4097 + extra)}).encode()
    assert len(body) > 4096
    assert_bad_body(call(body))


@SETTINGS
@given(st.binary(min_size=1, max_size=200))
def test_non_json_body_is_400(raw):
    try:
        json.loads(raw)
    except (ValueError, UnicodeError):
        pass
    else:
        return  # parses as JSON; covered by the non-object test or the 422 test
    assert_bad_body(call(raw))


@SETTINGS
@given(st.one_of(
    st.lists(st.integers(), max_size=5),
    st.integers(),
    st.text(max_size=20),
    st.booleans(),
    st.none(),
    st.floats(allow_nan=False, allow_infinity=False),
))
def test_non_object_json_is_400(value):
    assert_bad_body(call(json.dumps(value).encode()))
