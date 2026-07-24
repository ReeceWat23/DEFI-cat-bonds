// Admin password configuration.
// Default password: catbond-admin
//
// To change the password before going live:
//   1. Open a terminal and run:
//      node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update('YOUR_NEW_PASSWORD').digest('hex'))"
//   2. Paste the output hash below.
//
export const ADMIN_PASSWORD_HASH = '8557d4fa739d503cb2d101f8a5b79a68a96c5bc2ed4ad35b7c7b0eda065de150'

export async function checkPassword(input) {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return hex === ADMIN_PASSWORD_HASH
}
