import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, type Config } from "wagmi";
import { robinhoodChain } from "./chain";
import { site } from "./site";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

const transports = { [robinhoodChain.id]: http() };

/**
 * With a WalletConnect project id: RainbowKit's full default wallet list.
 * Without one: injected wallets only, so the app works out of the box.
 */
export const wagmiConfig: Config = projectId
  ? getDefaultConfig({
      appName: site.name,
      appDescription: site.description,
      appUrl: site.url,
      projectId,
      chains: [robinhoodChain],
      transports,
      ssr: true,
    })
  : createConfig({
      chains: [robinhoodChain],
      connectors: connectorsForWallets([{ groupName: "browser wallets", wallets: [injectedWallet] }], {
        appName: site.name,
        projectId: "injected-only",
      }),
      transports,
      ssr: true,
    });

export const hasWalletConnect = Boolean(projectId);
