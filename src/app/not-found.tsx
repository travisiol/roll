import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="mx-auto flex max-w-7xl flex-1 flex-col items-start justify-center gap-4 px-4 py-24 sm:px-6">
        <h1 className="display text-4xl">No table here.</h1>
        <p className="text-ash">The layout you asked for does not exist.</p>
        <Link href="/" className="btn btn-line">
          Back to the tables
        </Link>
      </main>
    </>
  );
}
