#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  RHODEX APIs — run every test suite in this folder
#
#  Usage:
#    ./api/run_tests.sh
#
#  Requires: python3, pip packages in requirements.txt, curl, RHODEX_API_KEY
#  set in .env at the repo root. Runs against the live "version-test" APIs —
#  no mocking exists for either suite, so this creates real (throwaway)
#  records in the bonds database each run.
# ────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")"

FAIL=0

echo "════════════════════════════════════════════════"
echo "  RHODEX APIs — full test run"
echo "════════════════════════════════════════════════"

echo ""
echo "── NatCat Loss API (endpoint validation) ──────────"
if ./validate.sh; then
  echo "[PASS] validate.sh"
else
  echo "[FAIL] validate.sh"
  FAIL=1
fi

echo ""
echo "── Bonds API (unit + live integration tests) ──────"
if python3 -m pytest test_bonds.py -v; then
  echo "[PASS] test_bonds.py"
else
  echo "[FAIL] test_bonds.py"
  FAIL=1
fi

echo ""
echo "════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  All suites passed."
else
  echo "  One or more suites failed — see output above."
fi
echo "════════════════════════════════════════════════"

exit $FAIL
