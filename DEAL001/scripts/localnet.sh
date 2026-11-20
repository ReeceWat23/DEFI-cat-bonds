#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  DEAL001 — local Solana environment (the Solana counterpart of DEAL 000's run.sh)
#
#  Usage (from DEAL001/):
#    npm run localnet            default scenario (1-hour subscription, 3-day term)
#    npm run localnet -- quick   quick scenario  (1-min subscription, 5-min term)
#
#  Starts a fresh solana-test-validator with the cat_bond program preloaded,
#  then runs scripts/setup-local.ts: RDX mint, two canonical triggers, one
#  test bond, and funded company / sponsor / investor wallets. Your own
#  browser wallets can be added via DEAL001/.localnet/test-wallets.json.
#  The validator keeps running in the background until you stop it
#  (pkill -f solana-test-validator).
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

SO=target/deploy/cat_bond.so
KEYPAIR=target/deploy/cat_bond-keypair.json
LOCAL=.localnet
LOG="$LOCAL/validator.log"

if [ ! -f "$SO" ] || [ ! -f "$KEYPAIR" ]; then
  echo "  No program build found — run \`anchor build\` in DEAL001 first." >&2
  exit 1
fi
PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR")

# Wallet keypairs, and the RDX mint's keypair, persist across restarts: the
# wallets only need importing into a browser wallet once, and the RDX token
# keeps the same mint address so wallets keep tracking it. (The accounts
# themselves are recreated on every fresh validator.)
mkdir -p "$LOCAL/keys"
for who in company sponsor investor rdx-mint; do
  if [ ! -f "$LOCAL/keys/$who.json" ]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$LOCAL/keys/$who.json" >/dev/null
  fi
done

echo ""
echo "  Stopping any existing solana-test-validator..."
pkill -f solana-test-validator 2>/dev/null || true
sleep 1

echo "  Starting solana-test-validator with cat_bond ($PROGRAM_ID)..."
nohup solana-test-validator \
  --reset \
  --quiet \
  --ledger "$LOCAL/ledger" \
  --bpf-program "$PROGRAM_ID" "$SO" \
  > "$LOG" 2>&1 &

echo -n "  Waiting for the validator"
for _ in $(seq 1 60); do
  if solana cluster-version -u localhost >/dev/null 2>&1; then
    echo " — ready!"
    break
  fi
  sleep 0.5
  echo -n "."
done
if ! solana cluster-version -u localhost >/dev/null 2>&1; then
  echo ""; echo "  Validator didn't start — see $LOG" >&2; exit 1
fi

npx tsx scripts/setup-local.ts "$@"

echo "  Validator log: DEAL001/$LOG   ·   stop with: pkill -f solana-test-validator"
echo ""
