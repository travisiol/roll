import { CHAIN_ID, EXPLORER_URL } from "@/lib/chain";
import { PYTH_ADDRESS } from "@/lib/contracts";

const steps = [
  {
    n: "1",
    title: "Pick a table",
    body: "An asset and a day. The layout is 39 numbers one tick apart, centred on the price when the table opened, plus two greens: below the lowest number and above the highest.",
  },
  {
    n: "2",
    title: "Pick the price",
    body: "One number is a straight-up: the print has to land inside that one tick. Take several numbers for a zone; your stake spreads evenly over them, so a zone lands more often and pays less.",
  },
  {
    n: "3",
    title: "The print decides",
    body: "At 16:00 UTC the first Pyth price at or after the second lands in exactly one cell. Everyone on it shares the whole pot, minus 2.7 %. Nobody on it: the pot rolls to tomorrow's table.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="hairline scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h2 className="display text-3xl sm:text-4xl">How it works</h2>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="card p-6">
              <div className="num text-sm text-red">{s.n}</div>
              <h3 className="display mt-3 text-2xl">{s.title}</h3>
              <p className="mt-3 leading-relaxed text-ash">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TheMath() {
  return (
    <section className="hairline">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="display text-3xl sm:text-4xl">The math, on one table</h2>
          <p className="mt-4 leading-relaxed text-ash">
            There is no house and no odds-maker. The pot is every stake on the table, the winners are whoever sits on the cell the print lands in,
            and each of them takes the pot in proportion to the weight they put there. A straight-up puts your whole stake on one cell; a zone of
            five puts a fifth on each.
          </p>
          <p className="mt-4 leading-relaxed text-ash">
            The quote the ticket shows is exactly this arithmetic, run on the pot as it stands with your roll added. It moves until the table
            closes — every roll after yours changes it.
          </p>
        </div>
        <div className="card p-6">
          <div className="text-sm text-smoke">example · BTC table, $200 numbers</div>
          <dl className="num mt-4 grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
            <dt className="text-ash">pot before you</dt>
            <dd className="text-right">1.2000 ETH</dd>
            <dt className="text-ash">already on $80,000</dt>
            <dd className="text-right">0.1500 ETH</dd>
            <dt className="text-ash">your straight-up on $80,000</dt>
            <dd className="text-right text-red">0.0500 ETH</dd>
            <dt className="text-ash">pool after the 2.7 % rake</dt>
            <dd className="text-right">1.2163 ETH</dd>
            <dt className="text-ash">your share of the cell</dt>
            <dd className="text-right">0.05 / 0.20 = 25 %</dd>
            <dt className="mt-2 border-t border-line pt-2 text-bone">print lands in $79,900 – $80,099.99</dt>
            <dd className="mt-2 border-t border-line pt-2 text-right text-bone">0.3041 ETH · ×6.08</dd>
          </dl>
          <p className="mt-4 text-sm text-smoke">
            The same 0.05 ETH as a zone over five numbers puts 0.01 on each: it lands five times as often, and each landing pays about a fifth.
          </p>
        </div>
      </div>
    </section>
  );
}

const faq: { q: string; a: string }[] = [
  {
    q: "What is this, exactly?",
    a: "A parimutuel: every stake on a table goes into one pot, and the pot is shared by whoever is on the winning cell. There is no house taking the other side, no market maker, no token. The contract keeps the pot, takes 2.7 % of a settled pot for the treasury (the single-zero wheel's edge, as it happens) and pays the rest out.",
  },
  {
    q: "Where does the settlement price come from?",
    a: `Pyth, on chain. The contract calls the Pyth contract on Robinhood Chain (${PYTH_ADDRESS}) with a signed update and asks for the first print at or after the expiry second — Pyth itself rejects any update that is not that first print. Anyone can settle: the site fetches the update from Pyth's Hermes service through its own key, and anyone with their own key can call settle() directly.`,
  },
  {
    q: "What if the price leaves the layout?",
    a: "The two greens. BELOW is every price under the lowest number's lower bound, ABOVE every price from the highest number's upper bound. They are cells like any other: you can sit on them, and they win the whole pot when the day is wild.",
  },
  {
    q: "What if nobody is on the winning cell?",
    a: "The whole pot — untouched, no rake — becomes the carry of the next table opened for that asset, and shows on it as rolled money. A pot can roll several days in a row; it only pays out when a print lands on a cell somebody holds.",
  },
  {
    q: "What if nobody settles a table?",
    a: "Three days after expiry, anyone can void it. Every roll is refunded in full and the carry waits for the next table. Settlement also has a window: the print must be within fifteen minutes after expiry, which Pyth's feeds always satisfy.",
  },
  {
    q: "Why one expiry a day, at 16:00 UTC?",
    a: "One expiry means one pot per asset per day instead of a hundred thin ones. 16:00 UTC is noon in New York, inside market hours. Stocks are priced with Pyth's 24/7 index feeds rather than the exchange-hours feeds, so a Saturday table settles like any other.",
  },
  {
    q: "Who opens a table?",
    a: "Whoever rolls first. A table for a given day can be opened from 15:00 UTC the day before — the moment the previous one closes — and the price at that moment centres its layout. Opening and the first roll are one transaction.",
  },
  {
    q: "Is this live?",
    a: "Not yet. The contract is written and tested (23 tests: layout rounding, split stakes, settlement math, rollover, void and refunds) but not deployed, and the site shows dashes instead of numbers until it is. There is no owner key: once deployed, nothing about the rules can change.",
  },
  {
    q: "Is it legal where I am?",
    a: "You are staking real money on a price outcome; in many places that is gambling or a derivative and regulated as such. It is on you to know whether you may take part, and not to if you may not. The code is open and the rules are entirely on chain — read them before you roll.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="hairline scroll-mt-20">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <h2 className="display text-3xl sm:text-4xl">Questions</h2>
        <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
          {faq.map((f) => (
            <div key={f.q}>
              <h3 className="text-[17px] font-medium text-bone">{f.q}</h3>
              <p className="mt-2 leading-relaxed text-ash">{f.a}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm text-smoke">
          Robinhood Chain · chain id {CHAIN_ID} ·{" "}
          <a href={`${EXPLORER_URL}/address/${PYTH_ADDRESS}`} className="underline decoration-line underline-offset-4 hover:text-ash" target="_blank" rel="noreferrer">
            Pyth contract
          </a>
        </p>
      </div>
    </section>
  );
}
