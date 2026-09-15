import type { MetadataRoute } from "next";
import { ASSETS } from "@/lib/catalog";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: site.url }, ...ASSETS.map((a) => ({ url: `${site.url}/table/${a.symbol.toLowerCase()}` }))];
}
