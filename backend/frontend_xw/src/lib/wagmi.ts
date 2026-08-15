import { createConfig, http } from "wagmi";
import { monadTestnet } from "viem/chains";
import { injected } from "wagmi/connectors";

/**
 * Chain definition comes from viem's built-in `monadTestnet`, but the
 * authoritative chainId/RPC/explorer values are the runtime `/config`
 * response (see services/api). Write paths validate `eth_chainId` against
 * config before sending (FRONTEND_DESIGN §16.5).
 */
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [monadTestnet.id]: http(),
  },
});

export { monadTestnet };
