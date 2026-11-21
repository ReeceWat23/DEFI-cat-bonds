#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  DEAL001 — deploy cat_bond to Solana devnet and seed the demo (plan Phase F)
#
#  Usage (from DEAL001/):   npm run devnet
#
#  1. Needs ~4 SOL on the deployer (.devnet/keys/deployer.json): ~1.8 SOL
#     program rent plus the same again for the upload buffer while deploying
#     (the buffer is refunded). The devnet RPC faucet is closed, so fund it at
#     https://faucet.solana.com (GitHub sign-in), then re-run.
#  2. Deploys (or upgrades) target/deploy/cat_bond.so at the fixed program id.
#     The deployer is the upgrade authority: back up .devnet/keys/deployer.json,
#     losing it means the devnet program can never be upgraded.
#  3. Runs scripts/setup-devnet.ts: canonical triggers + a small test bond.
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

URL=${RPC_URL:-https://api.devnet.solana.com}
SO=target/deploy/cat_bond.so
PROGRAM_KEYPAIR=target/deploy/cat_bond-keypair.json
DEPLOYER=.devnet/keys/deployer.json
NEED_SOL=4

mkdir -p .devnet/keys
for who in deployer company sponsor; do
  [ -f ".devnet/keys/$who.json" ] || solana-keygen new --no-bip39-passphrase --silent --outfile ".devnet/keys/$who.json" >/dev/null
done
[ -f "$SO" ] && [ -f "$PROGRAM_KEYPAIR" ] || { echo "  No program build: run \`anchor build\` first." >&2; exit 1; }

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
DEPLOYER_ADDR=$(solana-keygen pubkey "$DEPLOYER")
BAL=$(solana balance "$DEPLOYER_ADDR" -u "$URL" | awk '{print $1}')
echo ""
echo "  program   $PROGRAM_ID"
echo "  deployer  $DEPLOYER_ADDR  ($BAL SOL)"

if solana program show "$PROGRAM_ID" -u "$URL" -k "$DEPLOYER" >/dev/null 2>&1; then
  echo "  cat_bond is already on devnet; upgrading only if the build changed."
  NEED_SOL=2
fi
if awk "BEGIN{exit !($BAL < $NEED_SOL)}"; then
  echo ""
  echo "  Not enough SOL to deploy (have $BAL, need ~$NEED_SOL)."
  echo "  Fund $DEPLOYER_ADDR at https://faucet.solana.com (devnet), then re-run."
  exit 2
fi

echo ""
echo "  Deploying..."
solana program deploy "$SO" --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$DEPLOYER" --upgrade-authority "$DEPLOYER" -u "$URL"

echo ""
RPC_URL="$URL" npx tsx scripts/setup-devnet.ts
