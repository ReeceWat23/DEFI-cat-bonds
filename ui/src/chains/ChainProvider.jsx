// Mounts every chain family's provider once, at the app root. Both stay
// mounted so an EVM wallet and a Solana wallet can be connected side by
// side (plan §2).

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter'
import { WalletModalProvider } from '@solana/wallet-adapter/ui'
import '@solana/wallet-adapter/styles.css'   // all rules are scoped to .wallet-adapter-*
import { config as evmConfig } from './evm/config'

const queryClient = new QueryClient()

// The provider's chain only decides which wallets the picker lists (those
// that advertise it). Signing is per network: every write builds a signer for
// its own network's wallet chain (solana/adapter.js), so a devnet bond is
// signed for devnet even while localnet is running.
const SOLANA_WALLET_CHAIN = 'solana:devnet'

export function ChainProvider({ children }) {
  return (
    <WagmiProvider config={evmConfig}>
      <QueryClientProvider client={queryClient}>
        <SolanaWalletProvider chain={SOLANA_WALLET_CHAIN} autoConnect>
          <WalletModalProvider>
            {children}
          </WalletModalProvider>
        </SolanaWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
