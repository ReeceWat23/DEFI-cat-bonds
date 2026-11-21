// End-to-end check of the UI's Solana transaction code against a live local
// validator. Imports ui/src/chains/solana/core.js (the exact builders and
// send pipeline the Deal / Admin / Post deal pages use) and runs two real
// deals with the generated local keypairs standing in for browser wallets:
//
//   A: create trigger + bond → fund → deposit → close → report → claim →
//      mature → withdraw (sweeps the rest of the coupon)   (balances checked to the base unit)
//   B: create bond → fund → deposit → close → qualifying report → settle →
//      claim full coupon
//
// Plus error decoding: failing calls must surface the program's error name
// from simulation (what the pages map to friendly messages).
//
// Run from DEAL001/ while `npm run localnet` is up:
//   npx tsx scripts/e2e-ui-core.ts
//
// KeyPairSigners exercise the "wallet only signs, we send" path. Wallets that
// send transactions themselves take the other branch of sendInstructions,
// which this script can't simulate; that path is covered by testing in a
// real browser wallet.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const UI = path.join(here, '..', '..', 'ui')
const LOCAL = path.join(here, '..', '.localnet')

// Load Kit from the UI's node_modules so the signers and the UI core share one copy.
const kit = await import(path.join(UI, 'node_modules/@solana/kit/dist/index.node.mjs'))
const core = await import(path.join(UI, 'src/chains/solana/core.js'))
const gen = await import(path.join(UI, 'src/chains/solana/generated/index.ts'))

const addresses = JSON.parse(fs.readFileSync(path.join(LOCAL, 'addresses.json'), 'utf8'))
const rpc = kit.createSolanaRpc(addresses.rpcUrl)
const USDC = 1_000_000n
const B = 1_000_000_000n

const keypair = async (name: string) =>
  kit.createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(LOCAL, 'keys', `${name}.json`), 'utf8'))))
const company = await keypair('company')
const sponsor = await keypair('sponsor')
const investor = await keypair('investor')

let failures = 0
const pass = (msg: string) => console.log(`  ✓ ${msg}`)
const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`) }
const eq = (label: string, got: bigint | number | string, want: bigint | number | string) =>
  got === want ? pass(`${label} = ${got}`) : fail(`${label}: got ${got}, want ${want}`)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function send(signer: any, instructions: any[]) {
  return core.sendInstructions(rpc, signer, instructions)
}
async function act(signer: any, fn: string, bond: string, ...args: any[]) {
  return send(signer, await core.build[fn](signer, rpc, bond, ...args))
}
/** Expects the action to fail at simulation with this program error name. */
async function expectError(label: string, name: string, run: () => Promise<unknown>) {
  try {
    await run()
    fail(`${label}: succeeded, expected ${name}`)
  } catch (e: any) {
    const got = e?.cause?.data?.errorName
    got === name ? pass(`${label} → ${name} (decoded from simulation)`) : fail(`${label}: got "${got}" (${e?.message}), want ${name}`)
  }
}
async function balance(owner: string) {
  const acct = await core.ata(owner, addresses.mint)
  return BigInt((await rpc.getTokenAccountBalance(acct).send()).value.amount)
}
async function bondState(bond: string) {
  return core.loadBond(rpc, bond)
}

const PRODUCT = {
  productId: 'natcat_loss', version: 3, valuePath: '[0].economic_loss_b', units: 'usd_billions',
  maxReportAge: 150 * 86_400, endpoint: 'https://nqldthhutpfxpxnqqxsk.supabase.co/rest/v1/natcat_latest',
}
const TERMS = {
  threshold: 370n * B, couponRateBps: 800, coverageAmount: 100_000n * USDC, minInvestment: 50_000n * USDC,
  subscriptionDuration: 3_600, sellerName: 'E2E Seller',
  exposure: [{ region: 'US', pct: 60 }, { region: 'Japan', pct: 40 }],
}

console.log(`\n  UI core e2e · ${addresses.network} · program ${gen.CAT_BOND_PROGRAM_ADDRESS}`)

// ── Setup: a trigger the generated company can report to ──────────────────────
console.log('\n── Trigger (company owns + reports)')
const t = await core.build.createTrigger(company, { owner: company.address, reporter: company.address, ...PRODUCT })
await send(company, t.instructions)
const trigger = t.address
pass(`createTrigger → ${trigger}`)

// ── Deal A: matures ───────────────────────────────────────────────────────────
console.log('\n── Deal A: matures')
const TERM_A = 8 // seconds, real time on the validator
const a = await core.build.createBond(sponsor, {
  sponsor: sponsor.address, companyWallet: company.address, trigger, mint: addresses.mint,
  termDuration: TERM_A, dealId: `e2e-A-${Date.now()}`, ...TERMS,
})
await send(sponsor, a.instructions)
const bondA = a.address
eq('createBond → status', Number((await bondState(bondA)).status), gen.Status.Funding)

await expectError('deposit before funding', 'WrongStatus', () => act(investor, 'deposit', bondA, 50_000n * USDC, 50_000n * USDC))
await expectError('fund by a non-sponsor', 'NotSponsor', () => act(investor, 'fundCouponBudget', bondA))

const [sp0, co0, in0] = [await balance(sponsor.address), await balance(company.address), await balance(investor.address)]
await act(sponsor, 'fundCouponBudget', bondA)
eq('sponsor paid budget + 0.5%', sp0 - await balance(sponsor.address), 8_040n * USDC)

await expectError('deposit below minimum', 'BelowMinInvestment', () => act(investor, 'deposit', bondA, 1n, 1n))
await act(investor, 'deposit', bondA, 100_000n * USDC, 100_000n * USDC)
eq('investor paid principal + 0.5%', in0 - await balance(investor.address), 100_500n * USDC)
eq('company earned both fees', await balance(company.address) - co0, 540n * USDC)

await act(investor, 'closeSubscription', bondA)  // fully subscribed → closes early
eq('closeSubscription → status', Number((await bondState(bondA)).status), gen.Status.Active)

await send(company, await core.build.postReport(company, rpc, trigger, 100n * B, 'e2e below threshold'))
pass('postReport $100B')
await expectError('settle below threshold', 'TriggerNotFired', () => act(company, 'settle', bondA))
await expectError('mature before maturity', 'NotYetMatured', () => act(company, 'markMatured', bondA))

await sleep(3_000)
await act(investor, 'claimCoupon', bondA)
const partial = (await gen.fetchPosition(rpc, (await gen.findPositionPda({ bond: bondA, investor: investor.address }))[0])).data.claimed
partial > 0n && partial < 8_000n * USDC ? pass(`partial coupon claimed mid-term: ${Number(partial) / 1e6} RDX`) : fail(`partial claim ${partial}`)

const maturity = Number((await bondState(bondA)).maturity)
while (Math.floor(Date.now() / 1000) <= maturity + 1) await sleep(1_000)
await act(company, 'markMatured', bondA)
eq('markMatured → status', Number((await bondState(bondA)).status), gen.Status.Matured)
await act(investor, 'withdrawPrincipal', bondA)           // pays principal + the unclaimed rest of the coupon
await expectError('claim after withdraw', 'NothingToClaim', () => act(investor, 'claimCoupon', bondA))
await expectError('withdraw twice', 'AlreadyWithdrawn', () => act(investor, 'withdrawPrincipal', bondA))
eq('investor net: −0.5% fee + full 8% coupon', await balance(investor.address) - in0, 8_000n * USDC - 500n * USDC)
eq('vault emptied', BigInt((await rpc.getTokenAccountBalance((await bondState(bondA)).vault).send()).value.amount), 0n)

// ── Deal B: trigger fires ─────────────────────────────────────────────────────
console.log('\n── Deal B: trigger fires')
const b = await core.build.createBond(sponsor, {
  sponsor: sponsor.address, companyWallet: company.address, trigger, mint: addresses.mint,
  termDuration: 3_600, dealId: `e2e-B-${Date.now()}`, ...TERMS,
})
await send(sponsor, b.instructions)
const bondB = b.address
await act(sponsor, 'fundCouponBudget', bondB)
await act(investor, 'deposit', bondB, 100_000n * USDC, 100_000n * USDC)
await act(investor, 'closeSubscription', bondB)
await send(company, await core.build.postReport(company, rpc, trigger, 400n * B, 'e2e qualifying loss'))
await expectError('settle by a non-company wallet', 'NotCompanyWallet', () => act(sponsor, 'settle', bondB))
const spB = await balance(sponsor.address)
await act(company, 'settle', bondB)
eq('settle → status', Number((await bondState(bondB)).status), gen.Status.Triggered)
eq('sponsor received all principal', await balance(sponsor.address) - spB, 100_000n * USDC)
await expectError('withdraw after trigger', 'WrongStatus', () => act(investor, 'withdrawPrincipal', bondB))
const invB = await balance(investor.address)
await act(investor, 'claimCoupon', bondB)                 // full coupon after a trigger
eq('full 8% coupon claimable after trigger', await balance(investor.address) - invB, 8_000n * USDC)
eq('vault emptied after trigger', BigInt((await rpc.getTokenAccountBalance((await bondState(bondB)).vault).send()).value.amount), 0n)

console.log(failures ? `\n  ${failures} check(s) FAILED\n` : '\n  All checks passed.\n')
process.exit(failures ? 1 : 0)
