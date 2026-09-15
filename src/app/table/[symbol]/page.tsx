import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { TableScreen } from "@/components/table/TableScreen";
import { ASSETS, assetIndex } from "@/lib/catalog";
import { site } from "@/lib/site";

export function generateStaticParams() {
  return ASSETS.map((a) => ({ symbol: a.symbol.toLowerCase() }));
}

export async function generateMetadata({ params }: PageProps<"/table/[symbol]">): Promise<Metadata> {
  const { symbol } = await params;
  const i = assetIndex(symbol);
  if (i < 0) return {};
  const a = ASSETS[i];
  return { title: `${a.symbol} table — ${site.name}`, description: `Pick the ${a.name} price. Daily table, settled by the first Pyth print at 16:00 UTC.` };
}

export default async function TablePage({ params }: PageProps<"/table/[symbol]">) {
  const { symbol } = await params;
  const i = assetIndex(symbol);
  if (i < 0) notFound();
  return (
    <>
      <Nav />
      <main className="flex-1">
        <TableScreen asset={i} />
      </main>
      <Footer />
    </>
  );
}
