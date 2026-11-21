// Seeds Solana devnet for the shareable demo (plan Phase F), after
// scripts/devnet.sh has deployed cat_bond. Safe to re-run: anything that
// already exists is reused, not recreated.
//
//   1. Funds the generated devnet company + sponsor with a little SOL from the
//      deployer (they pay rent for the triggers / bond they sign).
//   2. Creates the two canonical triggers (owner = devnet company). Reporter =
//      your test company from .localnet/test-wallets.json if present (so you can
//      post reports from the Admin page), else the devnet company.
//   3. Creates one small-terms test bond on Circle devnet USDC, sponsored by the
//      generated devnet sponsor. Funding it needs USDC from https://faucet.circle.com
//      (Solana Devnet) in the sponsor's and an investor's wallets.
//
// Keys (gitignored): DEAL001/.devnet/keys/{deployer,company,sponsor}.json.
// Writes ui/src/chains/solana/devnet.json (public addresses, read by the UI
// registry; committed, since devnet doesn't reset) and .devnet/wallets.txt
// (secret keys to import into a browser wallet: devnet only).

import {
  address, appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc,
  createTransactionMessage, getAddressEncoder, getBase58Decoder, getProgramDerivedAddress, getU64Encoder,
  lamports, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners, getBase64EncodedWireTransaction,
  type Address, type Instruction, type KeyPairSigner,
} from '@solana/kit'
import { getTransferSolInstruction } from '@solana-program/system'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAT_BOND_PROGRAM_ADDRESS, Status, fetchBond, fetchMaybeBond, fetchMaybeTrigger, fetchTrigger,
  getCreateBondInstructionAsync, getCreateTriggerInstruction,
} from '../clients/js/generated/index.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEAL001 = path.join(here, '..')
const DEVNET = path.join(DEAL001, '.devnet')
const UI_REGISTRY_FILE = path.join(DEAL001, '..', 'ui', 'src', 'chains', 'solana', 'devnet.json')

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'   // CAIP-2 devnet (plan §2.5)
const CIRCLE_DEVNET_USDC = address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')

const USDC = 1_000_000n
const PRODUCT = {                                // same as setup-local.ts / DEAL 000
  productId: 'natcat_loss',
  version: 3n,
  units: 'usd_billions',
  maxReportAge: BigInt(150 * 24 * 60 * 60),
  endpoint: 'https://nqldthhutpfxpxnqqxsk.supabase.co/rest/v1/natcat_latest',
}
const VALUE_PATHS = { economic: '[0].economic_loss_b', industry: '[0].industry_loss_b' }
const DEAL_ID = 'DEAL001-devnet-1'
// Small enough to fund from the Circle faucet: $10 coverage → $0.80 coupon budget.
const BOND_TERMS = {
  threshold: 370n * 1_000_000_000n,
  couponRateBps: 800,
  coverageAmount: 10n * USDC,
  minInvestment: 1n * USDC,
  subscriptionDuration: 86_400n,                 // 1 day (closes early once fully subscribed)
  termDuration: 3_600n,                          // 1 hour, so a full lifecycle fits in a demo
  sellerName: 'Raydion',
  exposure: [{ region: 'US', pct: 50 }, { region: 'China', pct: 30 }, { region: 'Brazil', pct: 15 }, { region: 'EU', pct: 5 }],
}
const SOL_FOR_SIGNERS = 50_000_000n              // 0.05 SOL each: covers trigger / bond rent + fees

const rpc = createSolanaRpc(RPC_URL)
const sha256 = (s: string) => new Uint8Array(createHash('sha256').update(s, 'utf8').digest())
const step = (s: string) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 52 - s.length))}`)

async function send(feePayer: KeyPairSigner, instructions: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions(instructions, m),
  )
  const signed = await signTransactionMessageWithSigners(message)
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
    encoding: 'base64', preflightCommitment: 'confirmed',
  }).send()
  for (let i = 0; i < 60; i++) {
    const { value: [st] } = await rpc.getSignatureStatuses([signature]).send()
    if (st?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(st.err)}`)
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return signature
    await new Promise(r => setTimeout(r, 1_000))
  }
  throw new Error(`transaction ${signature} not confirmed after 60 s`)
}

function keyFile(name: string) {
  return path.join(DEVNET, 'keys', `${name}.json`)
}
async function loadWallet(name: string) {
  const bytes = Uint8Array.from(JSON.parse(fs.readFileSync(keyFile(name), 'utf8')))
  return { signer: await createKeyPairSignerFromBytes(bytes), secretBase58: getBase58Decoder().decode(bytes) }
}

function testCompany(): Address | null {
  const file = path.join(DEAL001, '.localnet', 'test-wallets.json')
  if (!fs.existsSync(file)) return null
  const c = JSON.parse(fs.readFileSync(file, 'utf8')).company
  return c ? address(String(c)) : null
}

const pda = async (seeds: (string | Uint8Array)[]) =>
  (await getProgramDerivedAddress({ programAddress: CAT_BOND_PROGRAM_ADDRESS, seeds }))[0]

async function main() {
  console.log(`\n  DEAL001 devnet setup  ·  ${RPC_URL}  ·  program ${CAT_BOND_PROGRAM_ADDRESS}`)
  const program = await rpc.getAccountInfo(CAT_BOND_PROGRAM_ADDRESS, { encoding: 'base64' }).send()
  if (!program.value?.executable) throw new Error('cat_bond is not deployed on devnet yet: run scripts/devnet.sh')

  step('1. Signers')
  const deployer = (await loadWallet('deployer')).signer
  const wallets = { company: await loadWallet('company'), sponsor: await loadWallet('sponsor') }
  for (const [name, w] of Object.entries(wallets)) {
    const { value: bal } = await rpc.getBalance(w.signer.address).send()
    if (bal < SOL_FOR_SIGNERS / 2n) {
      await send(deployer, [getTransferSolInstruction({
        source: deployer, destination: w.signer.address, amount: lamports(SOL_FOR_SIGNERS),
      })])
    }
    console.log(`  ${name.padEnd(8)} ${w.signer.address}`)
  }
  const company = wallets.company.signer
  const sponsor = wallets.sponsor.signer
  const test = testCompany()
  const companyWallet = test ?? company.address
  const reporter = companyWallet

  step(`2. Canonical triggers (reporter = ${test ? 'your test company' : 'devnet company'})`)
  const triggers: Record<string, Address> = {}
  for (const [i, kind] of (['economic', 'industry'] as const).entries()) {
    const triggerId = BigInt(i + 1)
    const trigger = await pda(['trigger', getAddressEncoder().encode(company.address), getU64Encoder().encode(triggerId)])
    if ((await fetchMaybeTrigger(rpc, trigger)).exists) {
      console.log(`  ${kind.padEnd(8)} ${trigger}  (exists)`)
    } else {
      await send(company, [getCreateTriggerInstruction({
        owner: company, trigger, triggerId, reporter,
        productId: PRODUCT.productId, version: PRODUCT.version, valuePath: VALUE_PATHS[kind],
        units: PRODUCT.units, maxReportAge: PRODUCT.maxReportAge, endpointHash: sha256(PRODUCT.endpoint),
      })])
      console.log(`  ${kind.padEnd(8)} ${trigger}`)
    }
    triggers[kind] = trigger
  }

  step('3. Small-terms test bond (Circle devnet USDC)')
  const bondId = sha256(DEAL_ID)
  const bond = await pda(['bond', getAddressEncoder().encode(sponsor.address), bondId])
  if ((await fetchMaybeBond(rpc, bond)).exists) {
    console.log(`  bond     ${bond}  (exists)`)
  } else {
    await send(sponsor, [await getCreateBondInstructionAsync({
      sponsor, trigger: triggers.economic, mint: CIRCLE_DEVNET_USDC, bond, bondId,
      companyWallet, dealId: DEAL_ID, ...BOND_TERMS,
    })])
    console.log(`  bond     ${bond}   dealId "${DEAL_ID}"`)
  }
  const b = (await fetchBond(rpc, bond)).data
  const t = (await fetchTrigger(rpc, triggers.economic)).data
  console.log(`  status ${Status[b.status]} · coverage ${Number(b.coverageAmount) / 1e6} USDC · budget ${Number(b.requiredCouponBudget) / 1e6} USDC · trigger reports ${t.reportCount}`)

  const publicInfo = {
    network: NETWORK,
    environment: 'testnet',
    rpcUrl: RPC_URL,
    programId: CAT_BOND_PROGRAM_ADDRESS,
    mint: CIRCLE_DEVNET_USDC,
    companyWallet,
    triggers,
    bonds: [{ address: bond, dealId: DEAL_ID }],
    wallets: { deployer: deployer.address, company: company.address, sponsor: sponsor.address },
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(UI_REGISTRY_FILE, JSON.stringify(publicInfo, null, 2) + '\n')
  fs.writeFileSync(path.join(DEVNET, 'addresses.json'), JSON.stringify(publicInfo, null, 2) + '\n')
  fs.writeFileSync(
    path.join(DEVNET, 'wallets.txt'),
    '# DEAL001 devnet wallets: DEVNET ONLY, never use on mainnet.\n' +
    '# Import into Phantom / Solflare / Backpack as a private key, with the wallet on devnet.\n\n' +
    Object.entries(wallets).map(([n, w]) => `${n.padEnd(8)} ${w.signer.address}\n         ${w.secretBase58}\n`).join('\n'),
  )

  step('Done')
  console.log(`  bond      ${bond}   ← paste into /deal`)
  console.log(`  fund it:  Circle devnet USDC (https://faucet.circle.com, Solana Devnet) to`)
  console.log(`            sponsor ${sponsor.address}  (needs 0.804 USDC)`)
  console.log(`            and an investor wallet (up to 10.05 USDC for full coverage)`)
  console.log(`  wrote     ui/src/chains/solana/devnet.json, DEAL001/.devnet/{addresses.json,wallets.txt}\n`)
}

main().catch(e => { console.error('\n  Devnet setup failed:', e?.context ?? '', e); process.exit(1) })
