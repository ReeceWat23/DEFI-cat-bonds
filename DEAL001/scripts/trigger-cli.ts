// Solana side of api/report_trigger.py: read a cat_bond trigger's product
// config, or post a report to it, through ui/src/chains/solana/core.js (the
// same builders and send pipeline the Admin page uses). Prints one JSON object
// on stdout, so Python can call it as a subprocess.
//
//   npx tsx scripts/trigger-cli.ts info <trigger>
//   npx tsx scripts/trigger-cli.ts post <trigger> <value> <monitorRefHex>
//
// Options (both commands):
//   --rpc <url>          default: .localnet/addresses.json rpcUrl, else http://127.0.0.1:8899
//   --keypair <path>     reporter keypair JSON (post only); default .localnet/keys/company.json
//
// <value> is the on-chain integer (e.g. usd_billions × 1e9). <monitorRefHex>
// is 32 bytes of hex, with or without 0x: the monitor entry's raw_response_hash.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const UI = path.join(here, '..', '..', 'ui')
const LOCAL = path.join(here, '..', '.localnet')

const kit = await import(path.join(UI, 'node_modules/@solana/kit/dist/index.node.mjs'))
const core = await import(path.join(UI, 'src/chains/solana/core.js'))

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function die(message: string): never {
  console.log(JSON.stringify({ error: message }))
  process.exit(1)
}

function defaultRpc(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(LOCAL, 'addresses.json'), 'utf8')).rpcUrl
  } catch {
    return 'http://127.0.0.1:8899'
  }
}

const [command, trigger, value, monitorRefHex] = process.argv.slice(2).filter((a, i, all) =>
  !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')))
if (!['info', 'post'].includes(command) || !trigger) {
  die('usage: trigger-cli.ts info <trigger> | post <trigger> <value> <monitorRefHex> [--rpc url] [--keypair path]')
}

const rpc = kit.createSolanaRpc(option('rpc') ?? defaultRpc())

try {
  if (command === 'info') {
    const t = await core.loadTrigger(rpc, trigger)
    console.log(JSON.stringify({
      productId: t.productId, version: Number(t.version), valuePath: t.valuePath, units: t.units,
      reporter: t.reporter, reportCount: Number(t.reportCount),
    }))
  } else {
    if (!value || !/^\d+$/.test(value)) die('value must be a non-negative integer')
    const hex = (monitorRefHex ?? '').replace(/^0x/, '')
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) die('monitorRefHex must be 32 bytes of hex')
    const monitorRef = Uint8Array.from(hex.match(/../g)!.map(b => parseInt(b, 16)))

    const keyPath = option('keypair') ?? path.join(LOCAL, 'keys', 'company.json')
    const reporter = await kit.createKeyPairSignerFromBytes(
      Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8'))))

    const before = await core.loadTrigger(rpc, trigger)
    const signature = await core.sendInstructions(
      rpc, reporter, await core.build.postReport(reporter, rpc, trigger, BigInt(value), monitorRef))
    console.log(JSON.stringify({ signature, reportIndex: Number(before.reportCount), reporter: reporter.address }))
  }
} catch (e: any) {
  die(e?.cause?.data?.errorName ? `${e.cause.data.errorName}: ${e.message}` : (e?.message ?? String(e)))
}
