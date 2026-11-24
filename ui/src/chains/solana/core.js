// Framework-free Solana core: typed account reads, the send pipeline
// (simulate → sign → send → confirm) and one builder per cat_bond
// instruction. No React and no browser-only imports, so the exact code the
// UI runs can also be driven from Node against a live validator
// (DEAL001/scripts/e2e-ui-core.ts).

import {
  address as toAddress, appendTransactionMessageInstructions, compileTransaction,
  createTransactionMessage, fetchEncodedAccount, fetchEncodedAccounts, getAddressEncoder,
  getBase58Decoder, getBase64EncodedWireTransaction, getProgramDerivedAddress, getU64Encoder,
  isTransactionMessageWithSingleSendingSigner, pipe, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signAndSendTransactionMessageWithSigners,
  signTransactionMessageWithSigners,
} from '@solana/kit'
import {
  TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync,
} from '@solana-program/token'
import {
  BOND_DISCRIMINATOR, CAT_BOND_PROGRAM_ADDRESS, TRIGGER_DISCRIMINATOR, decodeBond, decodeTrigger,
  getCheckTriggerInstruction, getClaimCouponInstructionAsync, getCloseSubscriptionInstruction,
  getCreateBondInstructionAsync, getCreateTriggerInstruction, getDepositInstructionAsync,
  getFundCouponBudgetInstruction, getMarkMaturedInstruction, getPostReportInstruction,
  getSettleInstruction, getWithdrawPrincipalInstructionAsync,
} from './generated'

// ── Typed account fetch ──────────────────────────────────────────────────────
// The generated decoders don't check the account's owner or Anchor
// discriminator: decoding a Trigger as a Bond throws, and an unrelated
// account of the right size could decode as garbage. So only decode an
// account this program owns whose first 8 bytes are the expected type tag;
// anything else is reported as "doesn't exist" (same as an empty address).

function isTyped(encoded, discriminator) {
  if (!encoded.exists || encoded.programAddress !== CAT_BOND_PROGRAM_ADDRESS) return false
  const data = encoded.data
  if (data.length < discriminator.length) return false
  return discriminator.every((byte, i) => data[i] === byte)
}

export async function fetchTyped(rpc, addr, discriminator, decode) {
  const encoded = await fetchEncodedAccount(rpc, toAddress(addr))
  return isTyped(encoded, discriminator) ? { exists: true, data: decode(encoded).data } : { exists: false }
}

export async function fetchAllTyped(rpc, addrs, discriminator, decode) {
  const encoded = await fetchEncodedAccounts(rpc, addrs.map(a => toAddress(a)))
  return encoded.map(e => (isTyped(e, discriminator) ? { exists: true, data: decode(e).data } : { exists: false }))
}

// ── PDAs & token accounts ────────────────────────────────────────────────────

export const pdaOf = async (seeds) =>
  (await getProgramDerivedAddress({ programAddress: CAT_BOND_PROGRAM_ADDRESS, seeds }))[0]

export const reportPda = (trigger, index) =>
  pdaOf(['report', getAddressEncoder().encode(toAddress(trigger)), getU64Encoder().encode(BigInt(index))])

export const ata = async (owner, mint) =>
  (await findAssociatedTokenPda({ owner: toAddress(owner), mint: toAddress(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]

/** Creates `owner`'s token account for `mint` if missing (no-op otherwise); `payer` pays rent. */
const ensureAta = (payer, owner, mint) =>
  getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: toAddress(owner), mint: toAddress(mint) })

export const sha256 = async (text) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * An Error shaped like the EVM adapter's (`cause.data.errorName`), so the
 * chain-neutral errorName() and the pages' error tables work unchanged.
 * cat_bond and CatBond.sol share error names, so one table covers both.
 */
export function chainError(message, errorName = '') {
  const err = new Error(message)
  err.shortMessage = message
  err.cause = { data: { errorName }, name: errorName }
  return err
}

/** Anchor logs "Error Code: <Name>." for both program and framework errors. */
function errorFromSimulation(err, logs = []) {
  const name = logs.map(l => /Error Code: (\w+)\./.exec(l)?.[1]).find(Boolean) ?? ''
  const detail = name || JSON.stringify(err, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  return chainError(`Transaction would fail: ${detail}`, name)
}

// ── Send pipeline ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** Polls until the transaction is confirmed (or fails / times out). */
export async function waitForConfirmation(rpc, signature, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send()
    const status = value[0]
    if (status?.err) throw errorFromSimulation(status.err)
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return
    await sleep(500)
  }
  throw chainError('Timed out waiting for confirmation. Check the transaction in an explorer.')
}

/**
 * Simulates, then signs and sends, `instructions` with `signer` as fee payer.
 * Simulating first means a failing transaction is reported by name (e.g.
 * BelowMinInvestment) before the wallet ever prompts. Handles both kinds of
 * wallet signer: ones that send the transaction themselves, and ones that
 * only sign (we send). `hooks.onSent(signature)` fires once it's submitted.
 * Resolves after confirmation with the signature; throws a chainError.
 */
export async function sendInstructions(rpc, signer, instructions, hooks = {}) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(signer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions(instructions, m),
  )

  const sim = await rpc.simulateTransaction(
    getBase64EncodedWireTransaction(compileTransaction(message)),
    { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' },
  ).send()
  if (sim.value.err) throw errorFromSimulation(sim.value.err, sim.value.logs ?? [])

  let signature
  if (isTransactionMessageWithSingleSendingSigner(message)) {
    signature = getBase58Decoder().decode(await signAndSendTransactionMessageWithSigners(message))
  } else {
    const signed = await signTransactionMessageWithSigners(message)
    signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: 'base64', preflightCommitment: 'confirmed',
    }).send()
  }
  hooks.onSent?.(signature)
  await waitForConfirmation(rpc, signature)
  return signature
}

// ── Instruction builders ─────────────────────────────────────────────────────
// Each returns the instruction list for one user action. Bond actions read
// the bond's current on-chain state first, so the accounts (mint, vault,
// sponsor, company, trigger) always come from the chain, never the UI.

export async function loadBond(rpc, bondAddress) {
  const acct = await fetchTyped(rpc, bondAddress, BOND_DISCRIMINATOR, decodeBond)
  if (!acct.exists) throw chainError('No cat_bond bond at this address on this network.')
  return acct.data
}

export async function loadTrigger(rpc, triggerAddress) {
  const acct = await fetchTyped(rpc, triggerAddress, TRIGGER_DISCRIMINATOR, decodeTrigger)
  if (!acct.exists) throw chainError('No cat_bond trigger at this address on this network.')
  return acct.data
}

export const build = {
  async fundCouponBudget(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [getFundCouponBudgetInstruction({
      sponsor: signer, bond: toAddress(bondAddress), sponsorToken: await ata(signer.address, b.mint),
      companyToken: await ata(b.companyWallet, b.mint), vault: b.vault, mint: b.mint,
    })]
  },

  async deposit(signer, rpc, bondAddress, amount, maxAccepted) {
    const b = await loadBond(rpc, bondAddress)
    return [
      await ensureAta(signer, b.companyWallet, b.mint),   // fee destination must exist
      await getDepositInstructionAsync({
        investor: signer, bond: toAddress(bondAddress), investorToken: await ata(signer.address, b.mint),
        companyToken: await ata(b.companyWallet, b.mint), vault: b.vault, mint: b.mint,
        amount: BigInt(amount), maxAccepted: BigInt(maxAccepted),
      }),
    ]
  },

  async closeSubscription(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [
      await ensureAta(signer, b.sponsor, b.mint),         // refund destination must exist
      getCloseSubscriptionInstruction({
        caller: signer, bond: toAddress(bondAddress), trigger: b.trigger, vault: b.vault,
        sponsorToken: await ata(b.sponsor, b.mint), mint: b.mint,
      }),
    ]
  },

  async claimCoupon(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [
      await ensureAta(signer, signer.address, b.mint),
      await getClaimCouponInstructionAsync({
        investor: signer, bond: toAddress(bondAddress), vault: b.vault,
        investorToken: await ata(signer.address, b.mint), mint: b.mint,
      }),
    ]
  },

  async withdrawPrincipal(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [
      await ensureAta(signer, signer.address, b.mint),
      await getWithdrawPrincipalInstructionAsync({
        investor: signer, bond: toAddress(bondAddress), vault: b.vault,
        investorToken: await ata(signer.address, b.mint), mint: b.mint,
      }),
    ]
  },

  async checkTrigger(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [getCheckTriggerInstruction({ caller: signer, bond: toAddress(bondAddress), trigger: b.trigger })]
  },

  async markMatured(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [getMarkMaturedInstruction({ companyWallet: signer, bond: toAddress(bondAddress), trigger: b.trigger })]
  },

  async settle(signer, rpc, bondAddress) {
    const b = await loadBond(rpc, bondAddress)
    return [
      await ensureAta(signer, b.sponsor, b.mint),         // principal destination must exist
      getSettleInstruction({
        companyWallet: signer, bond: toAddress(bondAddress), trigger: b.trigger, vault: b.vault,
        sponsorToken: await ata(b.sponsor, b.mint), mint: b.mint,
      }),
    ]
  },

  /**
   * `note` is a free-text note hashed into monitorRef (sha256; the EVM UI
   * uses keccak256), or an exact 32-byte monitorRef (a Uint8Array), e.g. the
   * monitor entry's raw_response_hash posted by api/report_trigger.py.
   */
  async postReport(signer, rpc, triggerAddress, value, note = '') {
    const t = await loadTrigger(rpc, triggerAddress)
    const monitorRef = note instanceof Uint8Array
      ? (note.length === 32 ? note : (() => { throw new Error('monitorRef must be 32 bytes') })())
      : await sha256(String(note).trim() || 'manual-admin-report')
    return [getPostReportInstruction({
      reporter: signer, trigger: toAddress(triggerAddress), report: await reportPda(triggerAddress, t.reportCount),
      value: BigInt(value), monitorRef,
    })]
  },

  /**
   * Same params as the EVM useEvmCreateBond. The signer posts the deal and
   * pays rent (the EVM deployer); `p.sponsor` is just an address, like the
   * EVM `_sponsor`, defaulting to the signer. bond_id = sha256(dealId).
   * Returns `{ instructions, address }`.
   */
  async createBond(signer, p) {
    const sponsor = toAddress(p.sponsor ?? signer.address)
    const bondId = await sha256(String(p.dealId))
    const bond = await pdaOf(['bond', getAddressEncoder().encode(sponsor), bondId])
    const ix = await getCreateBondInstructionAsync({
      payer: signer, sponsor, trigger: toAddress(p.trigger), mint: toAddress(p.mint), bond, bondId,
      companyWallet: toAddress(p.companyWallet), threshold: BigInt(p.threshold),
      couponRateBps: Number(p.couponRateBps), coverageAmount: BigInt(p.coverageAmount),
      minInvestment: BigInt(p.minInvestment), subscriptionDuration: BigInt(p.subscriptionDuration),
      termDuration: BigInt(p.termDuration), sellerName: p.sellerName, dealId: String(p.dealId),
      exposure: (p.exposure ?? []).map(e => ({ region: e.region, pct: Number(e.pct) })),
    })
    return { instructions: [ix], address: bond }
  },

  /**
   * Same params as the EVM useEvmCreateTrigger. The signer is the owner.
   * `triggerId` defaults to the current time in ms (unique per owner).
   * Returns `{ instructions, address }`.
   */
  async createTrigger(signer, p) {
    if (p.owner && p.owner !== signer.address) {
      throw chainError('On Solana the trigger owner must be the connected wallet, which signs the trigger into existence.')
    }
    const triggerId = BigInt(p.triggerId ?? Date.now())
    const trigger = await pdaOf(['trigger', getAddressEncoder().encode(signer.address), getU64Encoder().encode(triggerId)])
    const ix = getCreateTriggerInstruction({
      owner: signer, trigger, triggerId, reporter: toAddress(p.reporter),
      productId: p.productId, version: BigInt(p.version), valuePath: p.valuePath, units: p.units,
      maxReportAge: BigInt(p.maxReportAge), endpointHash: await sha256(p.endpoint),
    })
    return { instructions: [ix], address: trigger }
  },
}
