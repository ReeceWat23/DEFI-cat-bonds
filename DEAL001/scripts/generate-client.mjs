// Generates the typed @solana/kit client for cat_bond from the Anchor IDL.
//
//   npm run codegen        (after `anchor build`)
//
// Writes the same client to two places so each package resolves
// @solana/kit from its own node_modules (importing across folders would
// load two copies of Kit):
//   DEAL001/clients/js/generated/        ← scripts (setup-local.ts)
//   ui/src/chains/solana/generated/      ← the UI's Solana adapter
// Both are generated output: never edit them by hand, re-run this instead.

import { rootNodeFromAnchor } from '@codama/nodes-from-anchor'
import { renderVisitor } from '@codama/renderers-js'
import { createFromRoot } from 'codama'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const deal001 = path.join(here, '..')
const idlPath = path.join(deal001, 'target', 'idl', 'cat_bond.json')

if (!fs.existsSync(idlPath)) {
  console.error(`No IDL at ${path.relative(process.cwd(), idlPath)} — run \`anchor build\` in DEAL001 first.`)
  process.exit(1)
}

const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'))
const outputs = [
  path.join(deal001, 'clients', 'js', 'generated'),
  path.join(deal001, '..', 'ui', 'src', 'chains', 'solana', 'generated'),
]

for (const out of outputs) {
  const codama = createFromRoot(rootNodeFromAnchor(idl))
  await codama.accept(
    renderVisitor(out, {
      deleteFolderBeforeRendering: true,
      generatedFolder: '.',
      formatCode: true,
      // Only depend on @solana/kit (program-client-core comes via its
      // `@solana/kit/program-client-core` subpath), and don't write a
      // package.json into the output folder.
      kitImportStrategy: 'rootOnly',
      syncPackageJson: false,
    }),
  )
  console.log(`✓ cat_bond client (program ${idl.address}) → ${path.relative(path.join(deal001, '..'), out)}`)
}

// Browser fix for the UI copy only. The renderer emits Node-style
// `process.env["NODE_ENV"] !== "production"` checks (to keep readable error
// messages out of production). Browsers have no `process`, and Vite only
// replaces `import.meta.env.*`, so the UI crashed on import with
// "process is not defined". `import.meta.env?.DEV` keeps the same intent:
// true under `vite dev`, false in production builds. The `?.` lets the same
// file also load under Node (scripts/e2e-ui-core.ts imports the UI's core),
// where import.meta.env is undefined and messages are simply omitted.
// The scripts copy runs under Node, where `process` exists, so it's left alone.
const uiOut = outputs[1]
const NODE_ENV_CHECK = /process\.env\[["']NODE_ENV["']\]\s*!==\s*["']production["']/g
let patched = 0
for (const file of fs.readdirSync(uiOut, { recursive: true })) {
  if (!String(file).endsWith('.ts')) continue
  const full = path.join(uiOut, String(file))
  const src = fs.readFileSync(full, 'utf8')
  const next = src.replace(NODE_ENV_CHECK, () => { patched++; return 'import.meta.env?.DEV' })
  if (next !== src) fs.writeFileSync(full, next)
}
const leftover = fs.readdirSync(uiOut, { recursive: true })
  .filter(f => String(f).endsWith('.ts'))
  .filter(f => /\bprocess\./.test(fs.readFileSync(path.join(uiOut, String(f)), 'utf8')))
if (leftover.length) {
  console.error(`✗ UI client still references \`process\` in: ${leftover.join(', ')}. It will crash in the browser.`)
  process.exit(1)
}
console.log(`✓ UI client made browser-safe (${patched} NODE_ENV check${patched === 1 ? '' : 's'} → import.meta.env?.DEV)`)
