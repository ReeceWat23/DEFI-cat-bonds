import { createConfig, http } from 'wagmi'
import { sepolia, baseSepolia, arbitrumSepolia, foundry } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [foundry, sepolia, baseSepolia, arbitrumSepolia],
  connectors: [injected()],
  transports: {
    [foundry.id]: http('http://127.0.0.1:8545'),
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
  },
})
