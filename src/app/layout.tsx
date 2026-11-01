import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Providers } from "./providers";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/pixelify-sans/400.css";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Char2D — Pixel Character Maker", template: "%s | Char2D" }, description: "Turn one image into a playable pixel-art character." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers>
    <header className="site-header"><Link href="/" aria-label="Char2D home"><Image src="/brand/logo.jpeg" alt="Char2D" width={130} height={65} className="logo" priority /></Link>
    <nav aria-label="Main navigation"><Link href="/create">Create</Link><Link href="/playground">Playground</Link><Link href="/settings">Settings</Link></nav></header>
    <main>{children}</main><footer>Char2D · Pixel Character Maker · Local workspace</footer>
  </Providers></body></html>;
}
