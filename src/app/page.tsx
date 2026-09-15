import { Footer } from "@/components/Footer";
import { Hero } from "@/components/landing/Hero";
import { Faq, HowItWorks, TheMath } from "@/components/landing/Sections";
import { TablesStrip } from "@/components/landing/TablesStrip";
import { Nav } from "@/components/Nav";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <TablesStrip />
        <HowItWorks />
        <TheMath />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
