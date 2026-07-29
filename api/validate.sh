#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  RHODEX NatCat Loss API — endpoint validation
#
#  Usage:
#    chmod +x api/validate.sh
#    ./api/validate.sh
#
#  Requires: curl, python3 (for pretty-printing JSON)
#  No auth needed. Safe to run against production endpoint.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Load .env from repo root
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

API_URL="https://realestatesimplified.xyz/version-test/api/1.1/wf/RHODEX-NATCAT-LOSS"
API_KEY="${RHODEX_API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: RHODEX_API_KEY not set — check .env"
  exit 1
fi
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

ok()   { echo "  [PASS] $*"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }

post() {
    # post <description> <json-body>
    local desc="$1" body="$2"
    echo ""
    echo "── $desc"
    echo "   Body: $body"
    local status
    status=$(curl -s -o /tmp/rhodex_resp.json -w "%{http_code}" \
        -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $API_KEY" \
        -d "$body")
    echo "   HTTP: $status"
    if [ "$status" = "200" ]; then
        ok "HTTP 200 received"
    elif [ "$status" = "404" ]; then
        fail "HTTP 404 — endpoint not published yet on the server"
        return
    else
        fail "Expected 200, got $status"
        return
    fi
    echo "   Response:"
    python3 -m json.tool /tmp/rhodex_resp.json 2>/dev/null \
        | sed 's/^/     /' \
        || cat /tmp/rhodex_resp.json
}

check_field() {
    # check_field <field-name>
    # Looks in both the top-level response and inside response.response (Bubble nesting)
    local field="$1"
    if python3 -c "
import json
d = json.load(open('/tmp/rhodex_resp.json'))
inner = d.get('response', d)
assert '$field' in d or '$field' in inner, '$field missing'
" 2>/dev/null; then
        ok "Response contains '$field'"
    else
        fail "Response missing '$field'"
    fi
}

# ── Tests ─────────────────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════"
echo "  RHODEX NatCat Loss API — Validation"
echo "  $API_URL"
echo "════════════════════════════════════════════════"

# Test 1: ALL=yes — should return ALL-LOSSES list
post "Test 1: ALL=yes (all historical losses)" '{"ALL":"yes"}'
check_field "ALL-LOSSES"

# Test 2: YEAR + ALL=no — should return YEAR-LOSSES for 2026
post "Test 2: YEAR=2026, ALL=no (single year)" '{"ALL":"no","YEAR":"2026"}'
check_field "YEAR-LOSSES"

# Test 3: YEAR provided alongside ALL=yes — both fields expected
post "Test 3: YEAR=2025, ALL=yes (year + full list)" '{"ALL":"yes","YEAR":"2025"}'
check_field "ALL-LOSSES"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════"
printf "  Results: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "════════════════════════════════════════════════"
echo ""

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
