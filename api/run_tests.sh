#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  RHODEX API — run every Python test suite in this folder
#
#  Usage:
#    ./api/run_tests.sh
#
#  Requires: python3 + requirements.txt. Live tests run only when
#  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) are in
#  .env at the repo root; otherwise they skip. The live bonds test creates one
#  throwaway rpos row and deletes it; the NatCat live test is read-only.
# ────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "$(dirname "$0")"

python3 -m pytest test_bonds.py test_natcat_store.py test_products.py test_monitor.py test_report_trigger.py -v
