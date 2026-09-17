"""
Product registry — loads every product definition under api/products/,
validates each one, and answers lookups by (product_id, version) or by
scope. This is the one place that reads the JSON files; everything else
(the future monitor service, the future trigger-deploy flow, the admin
"build a trigger" writer in Iteration 2) goes through this module rather
than reading files directly.

Directory layout:
    api/products/public/<product>.v<N>.json
    api/products/private/<product>.v<N>.json   (empty in Iteration 1)

Malformed definitions and duplicate (product_id, version) pairs are load
errors, not silent skips — a broken product definition should fail loudly
before anything tries to deploy a trigger against it, not surface later as
a confusing monitor failure.
"""

from __future__ import annotations

import json
import os

from .schema import validate

_PRODUCTS_DIR = os.path.dirname(os.path.abspath(__file__))
_SCOPES = ("public", "private")


class RegistryError(Exception):
    """Raised when a product definition file is malformed or duplicated."""


def _scope_dir(scope: str) -> str:
    if scope not in _SCOPES:
        raise ValueError(f"scope must be one of {_SCOPES}, got {scope!r}")
    return os.path.join(_PRODUCTS_DIR, scope)


def _load_scope(scope: str) -> list[dict]:
    directory = _scope_dir(scope)
    if not os.path.isdir(directory):
        return []

    definitions = []
    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(directory, filename)
        with open(path, "r") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                raise RegistryError(f"{path}: invalid JSON — {e}") from e

        errors = validate(data)
        if errors:
            raise RegistryError(f"{path}: invalid product definition — " + "; ".join(errors))

        data["_scope"] = scope
        data["_file"] = filename
        definitions.append(data)

    return definitions


def load_all() -> list[dict]:
    """
    Load and validate every product definition across all scopes.

    Raises RegistryError on any malformed file or on a duplicate
    (product_id, version) pair — including a duplicate across public and
    private, since a product_id is meant to be globally stable regardless
    of which list it's offered in (§3.1's `visibility` is a separate,
    later concern from where the file physically lives in this iteration).
    """
    all_defs = []
    for scope in _SCOPES:
        all_defs.extend(_load_scope(scope))

    seen = {}
    for d in all_defs:
        key = (d["product_id"], d["version"])
        if key in seen:
            raise RegistryError(
                f"duplicate product definition for product_id={key[0]!r} version={key[1]}: "
                f"{seen[key]['_file']} and {d['_file']}"
            )
        seen[key] = d

    return all_defs


def list_products(scope: str | None = None, status: str | None = None) -> list[dict]:
    """
    List product definitions, optionally filtered by scope ("public" /
    "private") and/or status ("active" / "deprecated").
    """
    defs = load_all()
    if scope is not None:
        defs = [d for d in defs if d["_scope"] == scope]
    if status is not None:
        defs = [d for d in defs if d["status"] == status]
    return defs


def get(product_id: str, version: int) -> dict:
    """Look up one exact (product_id, version). Raises RegistryError if not found."""
    for d in load_all():
        if d["product_id"] == product_id and d["version"] == version:
            return d
    raise RegistryError(f"no product definition found for product_id={product_id!r} version={version}")


def get_latest_active(product_id: str) -> dict:
    """
    Return the highest-versioned "active" definition for a product_id.

    This is what a new trigger deploy should snapshot against — deploying
    against a deprecated version is a caller error, not something this
    function silently allows.
    """
    candidates = [d for d in load_all() if d["product_id"] == product_id and d["status"] == "active"]
    if not candidates:
        raise RegistryError(f"no active version found for product_id={product_id!r}")
    return max(candidates, key=lambda d: d["version"])
