// A Solana deal round-trips through the bond store (Supabase via api/server.py)
// exactly like Post deal does it: create the record → dealId → create the bond
// on-chain with that dealId → link the bond address back → read it back.
// The row stays behind with environment 'local' (server.py has no delete
// route), so the usual local cleanup clears it.
//
// Needs `npm run localnet` and `python3 api/server.py` running. From DEAL001/:
//   npx tsx scripts/e2e-bond-store.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const UI = path.join(here, '..', '..', 'ui')
const LOCAL = path.join(here, '..', '.localnet')
const API = process.env.BONDS_API ?? 'http://localhost:5001/bonds'

const kit = await import(path.join(UI, 'node_modules/@solana/kit/dist/index.node.mjs'))
const core = await import(path.join(UI, 'src/chains/solana/core.js'))

const addresses = JSON.parse(fs.readFileSync(path.join(LOCAL, 'addresses.json'), 'utf8'))
const rpc = kit.createSolanaRpc(addresses.rpcUrl)
const sponsor = await kit.createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(path.join(LOCAL, 'keys', 'sponsor.json'), 'utf8'))))

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` ${detail}` : ''}`)
}
async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

console.log(`\n  bond store round-trip · ${addresses.network}`)

// The genesis-hash id the UI registry uses must match the live validator.
const genesis = await rpc.getGenesisHash().send()
check('network id matches the running validator', addresses.network === `solana:${genesis.slice(0, 32)}`, addresses.network)

const trigger = addresses.triggers.economic
const { dealId } = await api('POST', API, {
  cedant: 'E2E Bond Store', description: 'throwaway row from DEAL001/scripts/e2e-bond-store.ts',
  value: 100_000, triggerAddress: trigger, productId: 'natcat_loss', productVersion: 3,
  network: addresses.network, environment: 'local',
})
check('record created', /^\d+$/.test(dealId), `dealId ${dealId}`)

try {
  const b = await core.build.createBond(sponsor, {
    sponsor: sponsor.address, companyWallet: addresses.companyWallet, trigger, mint: addresses.mint,
    threshold: 370_000_000_000n, couponRateBps: 800, coverageAmount: 100_000_000_000n,
    minInvestment: 1_000_000_000n, subscriptionDuration: 3_600, termDuration: 86_400,
    sellerName: 'E2E Bond Store', dealId, exposure: [{ region: 'US', pct: 100 }],
  })
  await core.sendInstructions(rpc, sponsor, b.instructions)
  const onchain = await core.loadBond(rpc, b.address)
  check('bond on-chain carries the dealId', onchain.dealId === dealId, b.address)

  await api('POST', `${API}/link`, { dealId, contractAddress: b.address, network: addresses.network })
  const row = await api('GET', `${API}/${dealId}`)
  check('row linked to the bond address', row.contract_address === b.address)
  check('row records network + environment', row.network === addresses.network && row.environment === 'local',
    `${row.network} / ${row.environment}`)

  const listed = await api('GET', `${API}?environment=local&network=${encodeURIComponent(addresses.network)}`)
  check('listed under its network', listed.some((r: any) => String(r.id) === dealId))
  const testnet = await api('GET', `${API}?environment=testnet`)
  check('not listed under testnet', !testnet.some((r: any) => String(r.id) === dealId))
} finally {
  console.log(`\n  (row ${dealId} left for cleanup: delete from rpos where environment = 'local')`)
}

console.log(failures ? `\n  ${failures} check(s) FAILED\n` : '\n  All checks passed.\n')
process.exit(failures ? 1 : 0)
