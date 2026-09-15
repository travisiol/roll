import type { Metadata } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { site } from "@/lib/site";

const display = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  weight: "variable",
});

const sans = Geist({ variable: "--font-geist", subsets: ["latin"] });

const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${site.name} — ${site.hook}`,
  description: site.description,
  metadataBase: new URL(site.url),
  openGraph: { title: site.name, description: site.description, type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
