import { createPublicClient, http, type PublicClient } from "viem";
import { robinhoodChain } from "../chain";

let client: PublicClient | undefined;

/** One viem client for route handlers, on the same RPC the browser uses. */
export function serverClient(): PublicClient {
  if (!client) client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0]) });
  return client;
}
