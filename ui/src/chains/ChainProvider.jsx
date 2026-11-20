// Mounts every chain family's provider once, at the app root. Both stay
// mounted so an EVM wallet and a Solana wallet can be connected side by
// side (plan §2). The Solana provider is added here in Phase C.

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config as evmConfig } from './evm/config'

const queryClient = new QueryClient()

export function ChainProvider({ children }) {
  return (
    <WagmiProvider config={evmConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
