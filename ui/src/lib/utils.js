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
