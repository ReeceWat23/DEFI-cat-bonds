"""
Validation for a single product definition file.

A product definition describes one managed API endpoint plus everything
needed to call it and pull one or more comparable numbers out of its
response. This module validates one definition (a dict, already parsed
from JSON) in isolation — it does not know about other definitions, so it
can't catch a duplicate (product_id, version) pair across files; that's
`registry.py`'s job, since only the registry sees the whole directory at
once.

Field reference (sprint plan `api/it3_plan_triggers_n_mgmnt.md` §2.2,
revised from the plan's original single-`value_path`/single-`peril_type`
shape — see note below):
    product_id                str    stable identifier, e.g. "natcat_loss"
    version                   int    starts at 1, bumps per the rule below
    status                    str    "active" | "deprecated"
    name                      str    human label
    endpoint                  str    URL the monitor calls
    method                    str    HTTP method, e.g. "GET" / "POST"
    auth                      str    name of the secret/env var to use for
                                      auth — never the secret value itself
    call_parameters           dict   request params/body the monitor sends
    response_schema           dict   shape of the raw response (free-form —
                                      just enough for a human/monitor to
                                      know what they're looking at)
    value_paths                dict   {metric_name: path}, at least one
                                      entry — see note below. `path` is
                                      either a single value_path string, or
                                      a fallback chain (list of strings,
                                      tried in order until one resolves —
                                      value_path.resolve_first()). A chain
                                      is for a field that doesn't always
                                      exist yet, e.g. an in-progress year's
                                      annual total, falling back to the
                                      latest available quarter.
    units                     str    unit of every value in value_paths
                                      (all metrics on one product share
                                      units in this iteration)
    update_frequency          str    how often the source actually changes,
                                      e.g. "quarterly" — informational, not
                                      enforced here
    max_report_age            int    days; a report older than this can no
                                      longer be used to settle a bond
                                      (Trigger.latestReportSince, §2.4)
    data_source_description   str    plain-language description of where
                                      this number comes from

Deviation from the plan as written: §2.2 specs a single `value_path` string
and a single `peril_type` per product, implying one product per peril. In
practice, one real API call (RHODEX's NatCat Loss endpoint) returns both
the industry-loss and economic-loss figures together in the same response
— splitting that into two "products" would mean the monitor polling the
same endpoint twice for identical underlying data. Consolidated instead:
one product can expose several named metrics (`value_paths`), and which
one a given trigger cares about is a deal-type/trigger-level choice (the
existing `dealType` on `TriggerBase.sol`), snapshotted into that trigger's
`productConfig` as a single resolved path at deploy time — the trigger
still only ever reads one `value_path`, this just moves where that
selection happens. There is no `peril_type` field on a product anymore;
peril selection is a trigger-time concern, not a product-time one.

Versioning rule: any change to endpoint, call_parameters, response_schema,
value_paths, or units must land as a new file at version+1, with the old
version's file left in place and its status flipped to "deprecated" — never
delete or edit those five fields on an existing version in place. Changing
only name/data_source_description does not require a version bump.

Comparison is always `value >= threshold`; there is deliberately no
comparison_op field.
"""

from __future__ import annotations

REQUIRED_FIELDS = (
    "product_id", "version", "status", "name",
    "endpoint", "method", "auth", "call_parameters", "response_schema",
    "value_paths", "units", "update_frequency", "max_report_age",
    "data_source_description",
)

VALID_STATUS = ("active", "deprecated")
VALID_METHODS = ("GET", "POST", "PUT")

# Fields that trigger a version bump when changed — see the versioning rule
# above. Exposed so registry.py (and later the admin "build a trigger" flow,
# §3.3) can diff two versions of the same product_id and confirm a bump was
# actually warranted, rather than trusting the caller.
VERSIONED_FIELDS = ("endpoint", "call_parameters", "response_schema", "value_paths", "units")


def validate(data: dict) -> list[str]:
    """
    Validate a single parsed product definition.

    Returns a list of human-readable error strings; empty list means valid.
    Never raises — callers (registry.py, and eventually the admin UI's
    custom-endpoint writer, §3.3) decide what to do with errors.
    """
    errors = []

    if not isinstance(data, dict):
        return [f"definition must be a JSON object, got {type(data).__name__}"]

    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(f"missing required field: {field!r}")

    # Only check types/values for fields that are actually present — a
    # missing field is already reported above, no need to double up.
    if "product_id" in data and not isinstance(data["product_id"], str):
        errors.append("product_id must be a string")
    if "product_id" in data and not data.get("product_id"):
        errors.append("product_id must not be empty")

    if "version" in data:
        v = data["version"]
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            errors.append("version must be an integer >= 1")

    if "status" in data and data["status"] not in VALID_STATUS:
        errors.append(f"status must be one of {VALID_STATUS}, got {data['status']!r}")

    if "name" in data and not isinstance(data["name"], str):
        errors.append("name must be a string")

    if "endpoint" in data:
        if not isinstance(data["endpoint"], str) or not data["endpoint"].startswith(("http://", "https://")):
            errors.append("endpoint must be a string starting with http:// or https://")

    if "method" in data and data["method"] not in VALID_METHODS:
        errors.append(f"method must be one of {VALID_METHODS}, got {data['method']!r}")

    if "auth" in data:
        if not isinstance(data["auth"], str) or not data["auth"]:
            errors.append("auth must be a non-empty string naming a secret/env var — never the secret value")
        elif len(data["auth"]) > 64 and any(c in data["auth"] for c in (".", "/", " ")):
            # Weak heuristic, not a hard rule: a real secret value (API key,
            # token) is unlikely to look like an env-var name. This exists
            # to catch an obvious mistake, not to guarantee correctness.
            errors.append("auth looks like it might be a secret value, not a secret name — double check")

    if "call_parameters" in data and not isinstance(data["call_parameters"], dict):
        errors.append("call_parameters must be an object")

    if "response_schema" in data and not isinstance(data["response_schema"], dict):
        errors.append("response_schema must be an object")

    if "value_paths" in data:
        vp = data["value_paths"]
        if not isinstance(vp, dict) or not vp:
            errors.append("value_paths must be a non-empty object of {metric_name: path}")
        else:
            for name, path in vp.items():
                if not isinstance(name, str) or not name:
                    errors.append(f"value_paths key {name!r} must be a non-empty string")
                # A path is either a single string, or a fallback chain —
                # a list of strings tried in order until one resolves (e.g.
                # an annual total that doesn't exist yet, falling back to
                # the latest available quarter). See value_path.resolve_first().
                if isinstance(path, str):
                    if not path:
                        errors.append(f"value_paths[{name!r}] must not be an empty string")
                elif isinstance(path, list):
                    if not path or not all(isinstance(p, str) and p for p in path):
                        errors.append(f"value_paths[{name!r}] fallback chain must be a non-empty list of non-empty strings")
                else:
                    errors.append(f"value_paths[{name!r}] must be a string or a list of strings (fallback chain)")

    if "units" in data and not isinstance(data["units"], str):
        errors.append("units must be a string")

    if "update_frequency" in data and not isinstance(data["update_frequency"], str):
        errors.append("update_frequency must be a string")

    if "max_report_age" in data:
        mra = data["max_report_age"]
        if not isinstance(mra, int) or isinstance(mra, bool) or mra < 1:
            errors.append("max_report_age must be an integer number of days >= 1")

    if "data_source_description" in data and not isinstance(data["data_source_description"], str):
        errors.append("data_source_description must be a string")

    return errors


def diff_versioned_fields(old: dict, new: dict) -> list[str]:
    """
    Return which of the version-bump-triggering fields differ between two
    definitions. Used to sanity-check that a new version file actually
    changed something that warranted bumping (or, conversely, that a
    same-version edit didn't silently change one of these fields).
    """
    return [f for f in VERSIONED_FIELDS if old.get(f) != new.get(f)]
