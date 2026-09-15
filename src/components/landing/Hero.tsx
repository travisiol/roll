"use client";

import Link from "next/link";
import { DiceHero } from "@/components/DiceHero";
import { ASSETS } from "@/lib/catalog";
import { isLive } from "@/lib/contracts";
import { fmtCountdown } from "@/lib/format";
import { useChainNow } from "@/lib/hooks";
import { currentExpiry } from "@/lib/layout";

export function Hero() {
  const now = useChainNow();
  const expiry = currentExpiry(now);
  return (
    <section className="relative overflow-hidden">
      {/* the only glow on the site: the red horizon the dice sit on */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72"
        style={{ background: "radial-gradient(60% 55% at 62% 100%, rgba(227,19,43,0.22) 0%, rgba(227,19,43,0) 70%)" }}
      />
      <div className="mx-auto grid max-w-7xl items-center gap-6 px-4 pb-10 pt-8 sm:px-6 md:grid-cols-[1.05fr_1fr] md:gap-4 md:pb-16 md:pt-12">
        <div className="order-2 md:order-1">
          <h1 className="display text-[44px] leading-[0.98] sm:text-[60px] lg:text-[74px]">
            Don&apos;t pick a side.
            <br />
            <span className="text-red">Pick the price.</span>
          </h1>
          <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ash">
            Daily tables on BTC, ETH and tokenized stocks. Stake on the exact number or a zone. At 16:00 UTC the first Pyth print picks one cell and
            everyone on it shares the pot. Nobody on it? The pot rolls.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="#tables" className="btn btn-chrome">
              Open the tables
            </Link>
            <Link href="#how" className="btn btn-line">
              How it works
            </Link>
          </div>
          <p className="mt-5 text-sm text-smoke">
            {isLive ? (
              <>
                {ASSETS.length} tables · next expiry in <span className="num text-ash">{fmtCountdown(expiry - now) || "…"}</span> · rolls close one hour before
              </>
            ) : (
              <>Contract written and tested, not deployed yet — the tables open at launch.</>
            )}
          </p>
        </div>
        <DiceHero className="order-1 h-[260px] w-full sm:h-[340px] md:order-2 md:h-[460px]" />
      </div>
    </section>
  );
}
