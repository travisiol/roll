/** Everything that names the product lives here. */
export const site = {
  // Placeholder name — not final
  name: "ROLL",
  hook: "Don't pick a side. Pick the price.",
  tagline: "Pick the price, not the side.",
  description:
    "Parimutuel price tables for BTC, ETH and tokenized stocks on Robinhood Chain. Pick the exact number or a zone; the first Pyth print at expiry decides. If nobody hits, the pot rolls.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://roll.example",
  twitter: "",
} as const;
