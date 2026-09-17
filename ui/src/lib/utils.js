export function formatUSDC(amount) {
  if (amount === undefined || amount === null) return '—'
  const n = Number(BigInt(amount)) / 1e6
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n)
}

export function parseUSDC(str) {
  const n = parseFloat(String(str).replace(/,/g, ''))
  if (isNaN(n) || n < 0) throw new Error('Invalid USDC amount')
  return BigInt(Math.round(n * 1e6))
}

export function formatDate(ts) {
  if (!ts || ts === 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleString()
}

export function formatBps(bps) {
  if (bps === undefined || bps === null) return '—'
  return `${(Number(bps) / 100).toFixed(2)}%`
}

export function statusLabel(s) {
  return ['Funding', 'Subscription', 'Active', 'Matured', 'Triggered'][Number(s)] ?? '—'
}

export function statusColor(s) {
  const n = Number(s)
  if (n === 0) return 'bg-gray-100 text-gray-700'
  if (n === 1) return 'bg-blue-100 text-blue-800'
  if (n === 2) return 'bg-green-100 text-green-800'
  if (n === 3) return 'bg-purple-100 text-purple-800'
  if (n === 4) return 'bg-red-100 text-red-800'
  return 'bg-gray-100 text-gray-700'
}

export function statusColorDark(s) {
  const n = Number(s)
  if (n === 0) return 'bg-gray-700 text-gray-200'
  if (n === 1) return 'bg-blue-900 text-blue-300'
  if (n === 2) return 'bg-green-900 text-green-300'
  if (n === 3) return 'bg-purple-900 text-purple-300'
  if (n === 4) return 'bg-red-900 text-red-300'
  return 'bg-gray-700 text-gray-200'
}

export function daysToSeconds(days) {
  return BigInt(Math.round(parseFloat(String(days)) * 86400))
}

export function safeParseUSDC(str) {
  try { return parseUSDC(str) } catch { return 0n }
}

/** Formats an on-chain "usd_billions x 1e9" integer as "$142B" / "$46M". */
export function formatUSDWhole(n) {
  if (n == null) return '—'
  const b = Number(n) / 1e9
  if (b >= 1) return `$${b.toFixed(0)}B`
  const m = Number(n) / 1e6
  return `$${m.toFixed(0)}M`
}

/** Human-readable age of a unix-seconds timestamp, e.g. "3h ago", "12d ago". */
export function formatAge(reportedAtSeconds) {
  if (reportedAtSeconds === undefined || reportedAtSeconds === null || Number(reportedAtSeconds) === 0) return '—'
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - Number(reportedAtSeconds))
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`
  return `${Math.floor(ageSec / 86400)}d ago`
}
