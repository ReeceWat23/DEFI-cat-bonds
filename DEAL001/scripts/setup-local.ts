// Seeds a fresh local validator with a DEAL001 test deal. Run via
// `npm run localnet` (which starts the validator first), or directly with
// `npx tsx scripts/setup-local.ts [quick]` against an already-running one.
//
// Mirrors DEAL 000's Setup.s.sol: same product, terms and seller, so the two
// chains can be compared side by side in the UI.
//
// Your own browser wallets (public keys only) can be added in
// DEAL001/.localnet/test-wallets.json (gitignored):
//   { "investor": "<addr>", "sponsor": "<addr>", "company": "<addr>" }
// Each is funded with SOL + RDX. The test "company" also becomes the bond's
// company wallet and the triggers' reporter, so it can settle, mature, verify
// and post reports. The seeded bond is posted by the generated sponsor (the
// payer, whose key we hold); the sponsor is just an address, so a test wallet
// could be named instead.
//
// Writes:
//   DEAL001/.localnet/addresses.json      everything below, for scripts
//   DEAL001/.localnet/wallets.txt         secret keys to import into a browser wallet
//   ui/src/chains/solana/localnet.json    public addresses only, read by the UI registry

import {
  address, airdropFactory, appendTransactionMessageInstructions, createKeyPairSignerFromBytes,
  createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, generateKeyPairSigner,
  getAddressEncoder, getBase58Decoder, getProgramDerivedAddress, getSignatureFromTransaction,
  getU64Encoder, lamports, pipe, sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address, type Instruction, type KeyPairSigner,
} from '@solana/kit'
import { getCreateAccountInstruction } from '@solana-program/system'
import {
  TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction, getMintSize, getMintToInstruction,
} from '@solana-program/token'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAT_BOND_PROGRAM_ADDRESS, Status, fetchBond, fetchTrigger,
  getCreateBondInstructionAsync, getCreateTriggerInstruction,
} from '../clients/js/generated/index.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const DEAL001 = path.join(here, '..')
const LOCAL = path.join(DEAL001, '.localnet')
const UI_REGISTRY_FILE = path.join(DEAL001, '..', 'ui', 'src', 'chains', 'solana', 'localnet.json')

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8899'
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:8900'

// ── Deal terms (match DEAL 000/script/Setup.s.sol) ────────────────────────────
const QUICK = process.argv.includes('quick')
const USDC = 1_000_000n                          // 6 decimals
const PRODUCT = {                                // ui/src/data/historicalLoss.js NATCAT_LOSS_PRODUCT
  productId: 'natcat_loss',
  version: 3n,
  units: 'usd_billions',
  maxReportAge: BigInt(150 * 24 * 60 * 60),      // 150 days
  endpoint: 'https://nqldthhutpfxpxnqqxsk.supabase.co/rest/v1/natcat_latest',
}
const VALUE_PATHS = { economic: '[0].economic_loss_b', industry: '[0].industry_loss_b' }
const DEAL_ID = 'DEAL001-local'
const BOND_TERMS = {
  threshold: 370n * 1_000_000_000n,              // $370B, whole USD
  couponRateBps: 800,                            // 8% flat on coverage
  coverageAmount: 500_000n * USDC,
  minInvestment: 50_000n * USDC,
  subscriptionDuration: QUICK ? 60n : 3_600n,
  termDuration: QUICK ? 300n : 259_200n,
  sellerName: 'Raydion',
  exposure: [
    { region: 'US', pct: 50 }, { region: 'China', pct: 30 },
    { region: 'Brazil', pct: 15 }, { region: 'EU', pct: 5 },
  ],
}
const RDX_PER_WALLET = 100_000_000n * USDC
const SOL_PER_WALLET = lamports(10n * 1_000_000_000n)

// ── Plumbing ─────────────────────────────────────────────────────────────────
const rpc = createSolanaRpc(RPC_URL)
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL)
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
const airdrop = airdropFactory({ rpc, rpcSubscriptions })

const sha256 = (s: string) => new Uint8Array(createHash('sha256').update(s, 'utf8').digest())

async function send(feePayer: KeyPairSigner, instructions: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    m => appendTransactionMessageInstructions(instructions, m),
  )
  const signed = await signTransactionMessageWithSigners(message)
  await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' })
  return getSignatureFromTransaction(signed)
}

type TestWallets = Partial<Record<'investor' | 'sponsor' | 'company', string>>
function loadTestWallets(): TestWallets {
  const file = path.join(LOCAL, 'test-wallets.json')
  if (!fs.existsSync(file)) return {}
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as TestWallets
  for (const [role, addr] of Object.entries(raw)) {
    try { address(String(addr)) } catch { throw new Error(`test-wallets.json: ${role} "${addr}" is not a valid Solana address`) }
  }
  return raw
}

const loadKeypair = (name: string) =>
  createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(LOCAL, 'keys', `${name}.json`), 'utf8'))))

async function loadWallet(name: string) {
  const bytes = Uint8Array.from(JSON.parse(fs.readFileSync(path.join(LOCAL, 'keys', `${name}.json`), 'utf8')))
  return { signer: await createKeyPairSignerFromBytes(bytes), secretBase58: getBase58Decoder().decode(bytes) }
}

const pda = async (seeds: (string | Uint8Array)[]) =>
  (await getProgramDerivedAddress({ programAddress: CAT_BOND_PROGRAM_ADDRESS, seeds }))[0]
const triggerPda = (owner: Address, id: bigint) =>
  pda(['trigger', getAddressEncoder().encode(owner), getU64Encoder().encode(id)])
const bondPda = (payer: Address, bondId: Uint8Array) =>   // the address derives from whoever posts the deal
  pda(['bond', getAddressEncoder().encode(payer), bondId])

const step = (s: string) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 52 - s.length))}`)

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n  DEAL001 local setup  ·  ${QUICK ? 'QUICK (1-min subscription / 5-min term)' : 'DEFAULT (1-hour subscription / 3-day term)'}`)
  console.log(`  RPC ${RPC_URL}  ·  program ${CAT_BOND_PROGRAM_ADDRESS}`)

  const genesisHash = await rpc.getGenesisHash().send()
  const network = `solana:${genesisHash.slice(0, 32)}`       // CAIP-2, unique per validator run (plan §2.5)

  step('1. Wallets')
  const wallets = {
    company: await loadWallet('company'),
    sponsor: await loadWallet('sponsor'),
    investor: await loadWallet('investor'),
  }
  for (const [name, w] of Object.entries(wallets)) {
    await airdrop({ recipientAddress: w.signer.address, lamports: SOL_PER_WALLET, commitment: 'confirmed' })
    console.log(`  ${name.padEnd(8)} ${w.signer.address}  (+10 SOL)`)
  }
  const company = wallets.company.signer
  const sponsor = wallets.sponsor.signer

  const testWallets = loadTestWallets()
  for (const [role, addr] of Object.entries(testWallets)) {
    await airdrop({ recipientAddress: address(addr), lamports: SOL_PER_WALLET, commitment: 'confirmed' })
    console.log(`  ${('test ' + role).padEnd(13)} ${addr}  (+10 SOL)`)
  }
  // Role holders on-chain. The test company, if given, runs the deal: it's
  // the bond's company wallet and the triggers' reporter.
  const companyWallet = testWallets.company ? address(testWallets.company) : company.address
  const reporter = companyWallet

  step('2. RDX mint (6 decimals, mint authority = company)')
  // Fixed keypair (.localnet/keys/rdx-mint.json) → same mint address every run.
  const mint = await loadKeypair('rdx-mint')
  const mintSpace = BigInt(getMintSize())
  const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace).send()
  await send(company, [
    getCreateAccountInstruction({
      payer: company, newAccount: mint, lamports: mintRent, space: mintSpace, programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({ mint: mint.address, decimals: 6, mintAuthority: company.address }),
  ])
  console.log(`  mint     ${mint.address}`)

  const tokenAccounts: Record<string, Address> = {}
  const holders: [string, Address][] = [
    ...Object.entries(wallets).map(([n, w]) => [n, w.signer.address] as [string, Address]),
    ...Object.entries(testWallets).map(([role, a]) => [`test ${role}`, address(a)] as [string, Address]),
  ]
  for (const [name, owner] of holders) {
    const [ata] = await findAssociatedTokenPda({ owner, mint: mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS })
    await send(company, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: company, owner, mint: mint.address }),
      getMintToInstruction({ mint: mint.address, token: ata, mintAuthority: company, amount: RDX_PER_WALLET }),
    ])
    tokenAccounts[name] = ata
    console.log(`  ${name.padEnd(13)} ${ata}  (+100,000,000 RDX)`)
  }

  step(`3. Canonical triggers (owner = generated company, reporter = ${testWallets.company ? 'test company' : 'company'})`)
  const triggers: Record<string, Address> = {}
  for (const [i, kind] of (['economic', 'industry'] as const).entries()) {
    const triggerId = BigInt(i + 1)
    const trigger = await triggerPda(company.address, triggerId)
    await send(company, [
      getCreateTriggerInstruction({
        owner: company, trigger, triggerId, reporter,
        productId: PRODUCT.productId, version: PRODUCT.version, valuePath: VALUE_PATHS[kind],
        units: PRODUCT.units, maxReportAge: PRODUCT.maxReportAge, endpointHash: sha256(PRODUCT.endpoint),
      }),
    ])
    triggers[kind] = trigger
    console.log(`  ${kind.padEnd(8)} ${trigger}`)
  }

  step('4. Test bond (sponsor signs, economic trigger)')
  const bondId = sha256(DEAL_ID)                              // UI convention: sha256(dealId)
  const bond = await bondPda(sponsor.address, bondId)
  await send(sponsor, [
    await getCreateBondInstructionAsync({
      payer: sponsor, sponsor: sponsor.address, trigger: triggers.economic, mint: mint.address, bond, bondId,
      companyWallet, dealId: DEAL_ID, ...BOND_TERMS,
    }),
  ])
  console.log(`  bond     ${bond}   dealId "${DEAL_ID}"`)
  console.log(`  sponsor  ${sponsor.address} (generated) · company wallet ${companyWallet}${testWallets.company ? ' (test)' : ''}`)

  step('5. Read back')
  const b = (await fetchBond(rpc, bond)).data
  const t = (await fetchTrigger(rpc, triggers.economic)).data
  console.log(`  status ${Status[b.status]} · coverage ${b.coverageAmount / USDC} · coupon budget ${b.requiredCouponBudget / USDC} · seller ${b.sellerName}`)
  console.log(`  exposure ${b.exposure.map(e => `${e.region} ${e.pct}%`).join(', ')} · trigger ${t.productId} v${t.version} ${t.valuePath} · reports ${t.reportCount}`)

  // ── Outputs ──
  const publicInfo = {
    network,
    environment: 'local',
    rpcUrl: RPC_URL,
    wsUrl: WS_URL,
    programId: CAT_BOND_PROGRAM_ADDRESS,
    mint: mint.address,
    companyWallet,
    triggers,
    bonds: [{ address: bond, dealId: DEAL_ID }],
    wallets: Object.fromEntries(Object.entries(wallets).map(([n, w]) => [n, w.signer.address])),
    testWallets,
    tokenAccounts,
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(LOCAL, 'addresses.json'), JSON.stringify(publicInfo, null, 2) + '\n')
  fs.mkdirSync(path.dirname(UI_REGISTRY_FILE), { recursive: true })
  fs.writeFileSync(UI_REGISTRY_FILE, JSON.stringify(publicInfo, null, 2) + '\n')
  fs.writeFileSync(
    path.join(LOCAL, 'wallets.txt'),
    '# DEAL001 localnet wallets: LOCAL TEST KEYS ONLY, never fund these on a real network.\n' +
    '# Import into Phantom / Solflare / Backpack as a private key, then point the wallet at http://127.0.0.1:8899.\n\n' +
    Object.entries(wallets).map(([n, w]) => `${n.padEnd(8)} ${w.signer.address}\n         ${w.secretBase58}\n`).join('\n'),
  )

  step('Done')
  console.log(`  network   ${network}`)
  console.log(`  bond      ${bond}   ← paste into /deal`)
  console.log(`  RDX mint  ${mint.address}   (same every run)`)
  console.log(`  wrote     DEAL001/.localnet/addresses.json, DEAL001/.localnet/wallets.txt (secret keys)`)
  console.log(`            ui/src/chains/solana/localnet.json (UI registry)\n`)
}

main().catch(e => { console.error('\n  Setup failed:', e?.context ?? '', e); process.exit(1) })
