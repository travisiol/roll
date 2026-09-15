"use client";

import { ConnectButton as RainbowConnect } from "@rainbow-me/rainbowkit";
import { shortAddress } from "@/lib/format";

/** RainbowKit's modal behind the site's own pill. */
export function ConnectButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const sz = size === "sm" ? "btn-sm" : "";
  return (
    <RainbowConnect.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;
        if (!mounted) {
          return (
            <button type="button" className={`btn btn-line ${sz}`} disabled aria-hidden>
              Connect
            </button>
          );
        }
        if (!connected) {
          return (
            <button type="button" className={`btn btn-line ${sz}`} onClick={openConnectModal}>
              Connect
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" className={`btn btn-red ${sz}`} onClick={openChainModal}>
              Switch to Robinhood Chain
            </button>
          );
        }
        return (
          <button type="button" className={`btn btn-line ${sz} num`} onClick={openAccountModal}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-chrome" />
            {shortAddress(account.address)}
          </button>
        );
      }}
    </RainbowConnect.Custom>
  );
}
