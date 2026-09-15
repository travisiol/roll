import Link from "next/link";
import { ConnectButton } from "./ConnectButton";
import { Wordmark } from "./Wordmark";

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-black/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="ROLL home" className="flex items-center gap-3">
          <Wordmark className="text-[22px]" />
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-ash sm:flex">
          <Link href="/#tables" className="hover:text-bone">
            Tables
          </Link>
          <Link href="/#how" className="hover:text-bone">
            How it works
          </Link>
          <Link href="/#faq" className="hover:text-bone">
            FAQ
          </Link>
        </nav>
        <ConnectButton />
      </div>
    </header>
  );
}
