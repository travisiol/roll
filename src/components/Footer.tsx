import Link from "next/link";
import { CHAIN_ID, EXPLORER_URL } from "@/lib/chain";
import { PYTH_ADDRESS, ROLL_ADDRESS } from "@/lib/contracts";
import { shortAddress } from "@/lib/format";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="hairline mt-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 text-sm text-ash sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <Wordmark className="text-[20px]" />
          <p className="max-w-sm text-smoke">
            Parimutuel price tables on Robinhood Chain, settled by Pyth. A game of skill and luck with real money: play what you can lose, and
            nothing where it is not legal.
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
          <dt className="text-smoke">chain</dt>
          <dd className="num">Robinhood Chain · {CHAIN_ID}</dd>
          <dt className="text-smoke">contract</dt>
          <dd className="num">
            {ROLL_ADDRESS ? (
              <a href={`${EXPLORER_URL}/address/${ROLL_ADDRESS}`} className="hover:text-bone" target="_blank" rel="noreferrer">
                {shortAddress(ROLL_ADDRESS)}
              </a>
            ) : (
              "not deployed yet"
            )}
          </dd>
          <dt className="text-smoke">oracle</dt>
          <dd className="num">
            <a href={`${EXPLORER_URL}/address/${PYTH_ADDRESS}`} className="hover:text-bone" target="_blank" rel="noreferrer">
              Pyth · {shortAddress(PYTH_ADDRESS)}
            </a>
          </dd>
          <dt className="text-smoke">code</dt>
          <dd>
            <Link href="/#faq" className="hover:text-bone">
              open source, no owner
            </Link>
          </dd>
        </dl>
      </div>
    </footer>
  );
}
