// Mounts every chain family's provider once, at the app root. Both stay
// mounted so an EVM wallet and a Solana wallet can be connected side by
// side (plan §2).

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter'
import { WalletModalProvider } from '@solana/wallet-adapter/ui'
import '@solana/wallet-adapter/styles.css'   // all rules are scoped to .wallet-adapter-*
import { config as evmConfig } from './evm/config'
import { defaultNetwork } from './registry'
import { FAMILY } from './types'

const queryClient = new QueryClient()

// One Solana wallet provider = one chain. Localnet while DEAL001's validator
// setup has run, otherwise devnet. Wallets that don't advertise this chain
// are hidden from the picker.
const SOLANA_WALLET_CHAIN = defaultNetwork(FAMILY.SOLANA)?.walletChain ?? 'solana:devnet'

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
