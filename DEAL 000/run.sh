#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  DEAL 000 — Local Anvil Setup Script
#
#  Usage:
#    ./run.sh          — default scenario (1-hour subscription, 3-day term)
#    ./run.sh quick    — quick maturity scenario (1-min subscription, 5-min term)
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"

RPC="http://127.0.0.1:8545"
LOG="/tmp/anvil-deal000.log"

# ── Parse scenario argument ───────────────────────────────────────────────────
SCENARIO="${1:-default}"

if [ "$SCENARIO" = "quick" ]; then
  export QUICK=1
  SUB_SECONDS=60
  TERM_SECONDS=300
  SCENARIO_LABEL="QUICK (1-min subscription / 5-min term)"
else
  export QUICK=0
  SUB_SECONDS=3600
  TERM_SECONDS=259200
  SCENARIO_LABEL="DEFAULT (1-hour subscription / 3-day term)"
fi

echo ""
echo "  Scenario: $SCENARIO_LABEL"

# ── 1. Start (or restart) Anvil ──────────────────────────────────────────────
echo ""
echo "  Stopping any existing anvil instance..."
pkill -f "^anvil" 2>/dev/null || true
sleep 1

echo "  Starting anvil (chain-id 31337, 2-second blocks)..."
anvil \
  --chain-id 31337 \
  --block-time 2 \
  --balance 10000 \
  --accounts 10 \
  > "$LOG" 2>&1 &
ANVIL_PID=$!

# ── 2. Wait for Anvil to accept connections ───────────────────────────────────
echo -n "  Waiting for anvil"
for i in {1..40}; do
  if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
    echo " — ready!"
    break
  fi
  sleep 0.5
  echo -n "."
done

echo ""

# ── 3. Create the web2 deal record, deploy, link, verify ─────────────────────
echo "  Deploying DEAL 000 contracts ($SCENARIO_LABEL)..."
echo ""

python3 ../api/deploy_deal.py fixture.json "$SCENARIO"

# ── 4. Print cheat-sheet ──────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXT STEPS  [$SCENARIO_LABEL]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Add Anvil to MetaMask:"
echo "     RPC URL:  http://127.0.0.1:8545"
echo "     Chain ID: 31337"
echo "     Symbol:   ETH"
echo ""
echo "  2. Start the UI (new terminal):"
echo "     cd ../ui && npm run dev"
echo ""
echo "  3. Open http://localhost:5174"
echo "     → Admin page → Manage: paste CatBond + Trigger addresses above"
echo "     → Deal Page: connect wallet, load bond, start testing"
echo ""
echo "  ── Time-travel commands ─────────────────────────────────"
echo ""
echo "  # Skip past subscription window ($SUB_SECONDS s):"
echo "  cast rpc anvil_increaseTime $SUB_SECONDS --rpc-url $RPC && cast rpc evm_mine --rpc-url $RPC"
echo ""
echo "  # Skip past bond term ($TERM_SECONDS s):"
echo "  cast rpc anvil_increaseTime $TERM_SECONDS --rpc-url $RPC && cast rpc evm_mine --rpc-url $RPC"
echo ""
echo "  # Check RDX balance of a wallet:"
echo "  cast call <RDX_ADDRESS> 'balanceOf(address)(uint256)' <WALLET> --rpc-url $RPC"
echo ""
echo "  # Check bond status (0=Funding 1=Sub 2=Active 3=Matured 4=Triggered):"
echo "  cast call <BOND_ADDRESS> 'status()(uint8)' --rpc-url $RPC"
echo ""
echo "  Anvil logs:  tail -f $LOG"
echo "  Anvil PID:   $ANVIL_PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
