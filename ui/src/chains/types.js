// Chain-neutral shapes shared by every adapter (see DEAL001/PLAN-multichain-ui.md §2.1).
//
// On-chain integers (amounts, timestamps, thresholds) stay bigint on both
// chains: viem and @solana/kit both decode u64/i64/u128 to bigint, and the
// formatters in lib/utils.js already accept bigint.

/** Lifecycle order is identical in CatBond.sol and the cat_bond program. */
export const STATUS = Object.freeze({
  Funding: 0,
  Subscription: 1,
  Active: 2,
  Matured: 3,
  Triggered: 4,
})

export const FAMILY = Object.freeze({ EVM: 'evm', SOLANA: 'solana' })

/**
 * @typedef {'evm' | 'solana'} ChainFamily
 *
 * @typedef {object} BondRef
 * @property {ChainFamily} family
 * @property {string|null} network  CAIP-2 chain id, e.g. 'eip155:84532',
 *                                  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'. Local
 *                                  chains get a per-run suffix (plan §2.5). null =
 *                                  the wallet's current network (pre-Phase-E behaviour).
 * @property {string}      address  0x-hex (EVM) or base58 (Solana)
 *
 * @typedef {object} LastCheck
 * @property {bigint}  value
 * @property {bigint}  reportedAt
 * @property {boolean} triggered
 * @property {bigint}  checkedAt
 * @property {string}  checkedBy
 *
 * @typedef {object} BondView     Fields are undefined while loading or if a read fails.
 * @property {boolean} exists     false = no bond at this address on the connected network
 * @property {number}  status     STATUS index 0–4
 * @property {string}  sponsor
 * @property {string}  companyWallet
 * @property {string}  trigger
 * @property {string}  mint       collateral token (USDC / RDX)
 * @property {bigint}  threshold
 * @property {number}  couponRateBps
 * @property {bigint}  coverageAmount
 * @property {bigint}  minInvestment
 * @property {bigint}  requiredCouponBudget
 * @property {bigint}  totalDeposited
 * @property {bigint}  subscriptionEnd
 * @property {bigint}  maturity
 * @property {bigint}  settlementTime
 * @property {bigint}  termDuration
 * @property {LastCheck|undefined} lastCheck
 * @property {string}  sellerName
 * @property {boolean} verified
 * @property {{region: string, pct: number}[]} exposure
 * @property {string}  dealId
 *
 * @typedef {object} PositionView  The connected wallet's stake in one bond.
 * @property {bigint}  principal
 * @property {bigint}  claimed
 * @property {boolean} withdrawn
 * @property {bigint}  tokenBalance
 * @property {bigint|null} tokenAllowance  null on chains with no approve step
 *
 * @typedef {object} TriggerView
 * @property {boolean} exists      false = no trigger at this address on the connected network
 * @property {bigint}  reportCount
 * @property {{value: bigint, reportedAt: bigint}|undefined} latest  undefined until the first report
 * @property {string}  productId
 * @property {bigint}  version
 * @property {string}  valuePath
 * @property {string}  units
 * @property {bigint}  maxReportAge  seconds
 * @property {string}  reporter
 * @property {string}  owner
 *
 * @typedef {object} TxState
 * @property {boolean} isWriting     waiting on the wallet
 * @property {boolean} isConfirming  submitted, waiting on the chain
 * @property {boolean} isConfirmed
 * @property {string|undefined} hash
 * @property {Error|null} error
 */
