"""
Resolves a product definition's `value_path` against a parsed JSON
response. See the convention documented in `products/README.md`:

    response.ALL-LOSSES[-1]."industry-loss | total"

A path is a sequence of segments:
  - a bareword key   (letters, digits, hyphen, underscore — no dots,
                       brackets, or quotes)               e.g. `response`
  - a quoted key      for keys containing spaces, pipes, or anything else
                       that would be ambiguous unquoted   e.g. `"industry-loss | total"`
  - a bracketed index (int, negative allowed — -1 means "last item")
                       e.g. `[-1]`

Segments after the first are separated by a literal `.` (bareword/quoted
key segments only — an index segment has no leading dot, it's its own
`[...]` token).
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(
    r'''
    \.?"([^"]+)"       # 1: dot-prefixed (optional) quoted key
    | \.?([A-Za-z0-9_\-]+)   # 2: dot-prefixed (optional) bareword key
    | \[(-?\d+)\]            # 3: bracketed index
    ''',
    re.VERBOSE,
)


class ValuePathError(ValueError):
    """Raised when a value_path is malformed or doesn't resolve against a response."""


def parse(path: str) -> list:
    """
    Tokenize a value_path string into a list of segments: strings for keys,
    ints for indices. Raises ValuePathError if any part of the path doesn't
    match a recognized token (catches typos rather than silently ignoring
    them).
    """
    if not path:
        raise ValuePathError("value_path must not be empty")

    segments = []
    pos = 0
    while pos < len(path):
        m = _TOKEN_RE.match(path, pos)
        if not m:
            raise ValuePathError(f"could not parse value_path at position {pos}: {path[pos:pos + 20]!r}...")
        if m.group(1) is not None:
            segments.append(m.group(1))
        elif m.group(2) is not None:
            segments.append(m.group(2))
        else:
            segments.append(int(m.group(3)))
        pos = m.end()

    return segments


def resolve(data: dict, path: str):
    """
    Walk `data` following `path` (as returned by parse()) and return the
    value found there. Raises ValuePathError with a specific, human-
    readable reason if any step fails — this is what the monitor's fetcher
    treats as "value_path does not resolve" per the sprint plan §2.3.
    """
    segments = parse(path)
    current = data
    walked = []

    for seg in segments:
        walked.append(seg)
        if isinstance(seg, int):
            if not isinstance(current, list):
                raise ValuePathError(f"expected a list at {_render(walked[:-1])}, got {type(current).__name__}")
            try:
                current = current[seg]
            except IndexError:
                raise ValuePathError(f"index {seg} out of range at {_render(walked)} (list has {len(current)} items)")
        else:
            if not isinstance(current, dict):
                raise ValuePathError(f"expected an object at {_render(walked[:-1])}, got {type(current).__name__}")
            if seg not in current:
                raise ValuePathError(f"key {seg!r} not found at {_render(walked)}")
            current = current[seg]

    if not isinstance(current, (int, float)) or isinstance(current, bool):
        raise ValuePathError(f"value_path resolved to a non-numeric value: {current!r} ({type(current).__name__})")

    return current


def resolve_first(data: dict, paths: list[str]):
    """
    Try each path in order, returning the value from the first one that
    resolves. Raises ValuePathError (naming every attempted path) only if
    none of them do.

    For a fallback chain: e.g. natcat_loss's current-year record has no
    full-year total until the year actually finishes — only quarterly
    figures exist until then. A product's value_paths entry can be this
    kind of list instead of a single string; the annual total is tried
    first, falling back to the latest available quarter, mirroring
    api/natcat_loss.py's own latest_loss_for_year() fallback order.
    """
    errors = []
    for path in paths:
        try:
            return resolve(data, path)
        except ValuePathError as e:
            errors.append(f"{path!r} ({e})")
    raise ValuePathError("no path in the fallback chain resolved — tried: " + "; ".join(errors))


def _render(segments: list) -> str:
    out = ""
    for seg in segments:
        if isinstance(seg, int):
            out += f"[{seg}]"
        elif out:
            out += f".{seg}"
        else:
            out = seg
    return out or "<root>"
