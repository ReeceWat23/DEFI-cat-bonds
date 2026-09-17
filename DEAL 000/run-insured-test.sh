#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  DEAL 000 — Insured (industry) loss test deal
#
#  Deploys a SECOND bond on the same anvil chain — industry-loss trigger,
#  $150B threshold — then reports the REAL current figure via
#  api/report_trigger.py, which pulls from the same RHODEX NatCat Loss API
#  as every other trigger. No hardcoded/manual report values — whatever
#  Gallagher Re's feed currently says for industry loss is what gets
#  reported, triggered or not.
#
#  Requires anvil already running (./run.sh or ./run.sh quick first) —
#  this script does NOT restart it, so both deals coexist for comparison.
#
#  Usage:
#    ./run-insured-test.sh
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"

RPC="http://127.0.0.1:8545"
THRESHOLD_B=150

if ! cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
  echo "Anvil isn't running. Start it first: ./run.sh quick"
  exit 1
fi

echo ""
echo "  Deploying INSURED LOSS test deal — \$${THRESHOLD_B}B threshold..."
echo ""

export QUICK=1
export TRIGGER_TYPE=0        # Industry (insured) loss
export LOSS_THRESHOLD_B=$THRESHOLD_B

python3 ../api/deploy_deal.py fixture.json quick

TRIGGER_ADDR=$(python3 -c "
import json
d = json.load(open('broadcast/Setup.s.sol/31337/run-latest.json'))
for tx in d['transactions']:
    if tx.get('transactionType') == 'CREATE' and tx.get('contractName') == 'Deal000Trigger':
        print(tx['contractAddress'])
")
BOND_ADDR=$(python3 -c "
import json
d = json.load(open('broadcast/Setup.s.sol/31337/run-latest.json'))
for tx in d['transactions']:
    if tx.get('transactionType') == 'CREATE' and tx.get('contractName') == 'CatBond':
        print(tx['contractAddress'])
")

echo ""
echo "  Reporting the real current industry loss figure (RHODEX NatCat Loss API)..."
echo ""

python3 ../api/report_trigger.py "$TRIGGER_ADDR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Insured loss test deal ready"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CatBond:  $BOND_ADDR"
echo "  Trigger:  $TRIGGER_ADDR"
echo ""
echo "  Paste the CatBond address into the Deal Page's load-bond box"
echo "  (http://localhost:5173/deal) to see it — whatever state printed"
echo "  above (triggered or not) is what the real current data says."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
