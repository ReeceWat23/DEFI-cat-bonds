# DEAL 000 — Local End-to-End Testing Environment

A complete local blockchain environment for testing the CatBond protocol end-to-end using the UI. Runs on Foundry's Anvil (local EVM) with three MetaMask wallets playing the roles of Company, Sponsor, and Investor.

---

## Wallets & Roles

| Role | Address | Responsibilities |
|------|---------|-----------------|
| **Company / Settler** | `0xE1ea925Bc3Ef4706ca6a22E72FC83828098377B9` | Deploys trigger, calls `settle()` and `markMatured()`, owns the ManualTrigger |
| **Sponsor** | `0x9106ca8aEA4dbd6C4885b535a70632C6D7610220` | Funds the coupon budget, receives principal if trigger fires |
| **Investor** | `0x923F2DAdB7D38d8Dd4629dFD1027537EaA722D66` | Deposits principal, claims coupon, withdraws principal at maturity |

Each wallet is pre-funded with **2 ETH** (gas) and **100,000,000 RDX** (the test stablecoin).

---

## Bond Parameters (DEAL 000)

| Parameter | Value |
|-----------|-------|
| Coverage Amount | $500,000 RDX |
| Min Investment | $50,000 RDX per investor |
| Coupon Rate | 8% flat on total coverage (800 BPS) |
| Subscription Window | 1 hour |
| Bond Term | 3 days |
| Required Coupon Budget | $40,000 RDX (sponsor deposits this + 0.5% fee = $40,200) |

**RDX token:** `RedX Dollar` — 1 RDX = $1 USD, 6 decimals (identical to USDC).

---

## Prerequisites

- [Foundry](https://getfoundry.sh) installed (`anvil`, `forge`, `cast` in PATH)
- MetaMask browser extension
- UI running (`cd ../ui && npm run dev`)

---

## Quickstart

### 1. Start the local environment

```bash
cd "DEAL 000"
./run.sh
```

This will:
- Kill any existing `anvil` process
- Start a fresh chain (chain-id 31337, 2-second blocks)
- Deploy RDX token, ManualTrigger, and CatBond
- Fund all three wallets with ETH and RDX
- Print the contract addresses

### 2. Note the deployed addresses

The script prints something like:
```
RDX Token:      0x5FbDB2315678afecb367f032d93F642f64180aa3
ManualTrigger:  0xa513E6E4b8f2a923D98304ec87F64353C4D5C853
CatBond:        0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6
```
Keep these handy.

### 3. Add Anvil to MetaMask

Open MetaMask → **Settings → Networks → Add Network → Add manually**:

| Field | Value |
|-------|-------|
| Network Name | Anvil Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency Symbol | `ETH` |

Switch all three wallets to the **Anvil Local** network. They will show 2 ETH automatically.

### 4. Add RDX to MetaMask (each wallet)

In MetaMask → **Import Token**:
- Token contract: paste the RDX address from step 2
- Symbol: `RDX`, Decimals: `6`

### 5. Start the UI

```bash
cd ../ui
npm run dev
```

Open **http://localhost:5174**

---

## Full Testing Walkthrough

### Phase 1 — Funding (Status: Funding)

**Connect as:** Company wallet

1. Go to **http://localhost:5174/admin**
2. Password: `catbond-admin`
3. In **Manage Bond**: paste the **CatBond** and **ManualTrigger** addresses

**Connect as:** Sponsor wallet

4. In **Admin → Manage**: click **"① Approve USDC"** under "Fund Coupon Budget"
   - Approves ~$771 RDX to the bond contract
   - After MetaMask confirms, click the button again → **"② Fund Coupon Budget"**

> Bond moves to **Subscription** status. The 1-hour window opens.

---

### Phase 2 — Subscription (Status: Subscription)

**Connect as:** Investor wallet

5. Go to the **Deal Page** (`/`) — it will auto-load the bond
6. Under **Investor Actions → Deposit USDC**:
   - Enter amount (min $50,000, max $500,000)
   - Click **"Approve USDC"** → confirm MetaMask
   - Click again → **"Deposit"** → confirm MetaMask

You can repeat with different amounts. The bond fills up to $500,000.

---

### Phase 3 — Close Subscription

After the subscription window closes (1 hour), anyone can close it.

**Option A — Wait:** The "Close Subscription & Start Bond" button appears on the Deal Page automatically once 1 hour passes.

**Option B — Fast-forward time:**
```bash
# Advance chain time by 1 hour
cast rpc anvil_increaseTime 3600 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```
Then click **"Close Subscription & Start Bond"** on the Deal Page.

> Bond moves to **Active** status.

---

### Phase 4A — Happy Path (No Trigger)

**Claim coupon during Active phase:**

Connect as Investor → Deal Page → **"Claim Coupon"** (claimable amount accrues per second)

**Advance past the 3-day term:**
```bash
cast rpc anvil_increaseTime 259200 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

**Connect as:** Company wallet → Admin → Manage → **"Mark Matured"**

> Bond moves to **Matured** status.

**Connect as:** Investor → Deal Page → **"Withdraw Principal"** (full deposit returned)

---

### Phase 4B — Trigger Path (Catastrophe Fires)

**Connect as:** Company wallet → Admin → Manage → **"Fire Trigger"**

> ManualTrigger `isTriggered()` returns `true`.

**Connect as:** Company wallet → Admin → Manage → **"Settle — Send Principal to Sponsor"**

> Bond moves to **Triggered** status. All investor principal transfers to sponsor.

**Connect as:** Investor → Deal Page → **"Claim Coupon"** (vested coupon up to settlement time is still claimable)

---

## Useful Cast Commands

```bash
RPC="http://127.0.0.1:8545"
BOND="<your-bond-address>"
RDX="<your-rdx-address>"

# Bond lifecycle state (0=Funding 1=Subscription 2=Active 3=Matured 4=Triggered)
cast call $BOND "status()(uint8)" --rpc-url $RPC

# Subscription end timestamp
cast call $BOND "subscriptionEnd()(uint256)" --rpc-url $RPC

# Maturity timestamp
cast call $BOND "maturity()(uint256)" --rpc-url $RPC

# Total deposited so far
cast call $BOND "totalDeposited()(uint256)" --rpc-url $RPC

# Investor principal
cast call $BOND "principalOf(address)(uint256)" 0x923F2DAdB7D38d8Dd4629dFD1027537EaA722D66 --rpc-url $RPC

# RDX balance of a wallet
cast call $RDX "balanceOf(address)(uint256)" <WALLET> --rpc-url $RPC

# Trigger state
cast call <TRIGGER_ADDRESS> "isTriggered()(bool)" --rpc-url $RPC

# Current block timestamp
cast block --rpc-url $RPC | grep timestamp

# Fast-forward 1 hour
cast rpc anvil_increaseTime 3600 --rpc-url $RPC && cast rpc evm_mine --rpc-url $RPC

# Fast-forward 3 days
cast rpc anvil_increaseTime 259200 --rpc-url $RPC && cast rpc evm_mine --rpc-url $RPC

# Tail anvil logs
tail -f /tmp/anvil-deal000.log
```

---

## Reset & Redeploy

To start completely fresh:
```bash
./run.sh
```

This kills the existing chain, starts a new one, and redeploys everything with fresh addresses. Update the addresses in the UI (Admin → Manage).

---

## Contract Sync Note

`src/catbond/` contains copies of the parent contracts (`CatBond.sol`, `ITrigger.sol`, `TriggerBase.sol`). If the parent contracts change, re-sync:

```bash
cp ../contracts/CatBond.sol ../contracts/ITrigger.sol ../contracts/TriggerBase.sol src/catbond/
forge build
```

---

## File Structure

```
DEAL 000/
├── run.sh              — start anvil + deploy everything
├── foundry.toml        — Foundry config (uses parent lib/)
├── src/
│   ├── RDX.sol         — test stablecoin (1 RDX = $1, 6 decimals)
│   └── catbond/        — copies of parent contracts for compilation
│       ├── CatBond.sol
│       ├── ITrigger.sol
│       └── TriggerBase.sol
└── script/
    └── Setup.s.sol     — deploy script (RDX + trigger + bond + fund wallets)
```
