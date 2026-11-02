import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Providers } from "./providers";
import { config } from "@/server/config";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/700.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Char2D — Pixel Character Maker", template: "%s | Char2D" }, description: "Turn one image into a playable pixel-art character.", openGraph: { images: ["/brand/logo-full.png"] } };
export const dynamic="force-dynamic";
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers>
    <div className="sky" aria-hidden="true"><span className="cloud c1" /><span className="cloud c2" /><span className="cloud c3" /><span className="cloud c4" /></div>
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Char2D home"><Image src="/brand/logo-hero.png" alt="" width={34} height={51} className="brand-mascot" priority /><span className="brand-word">Char2D</span></Link>
      <nav aria-label="Main navigation"><Link href="/#party">My characters</Link><Link href="/playground">Playground</Link><Link href="/settings">Settings</Link><Link className="nav-cta" href="/create">+ New character</Link></nav>
    </header>
    {config.fakeAI&&<p className="fake-banner" role="note">Fake AI mode — nothing is sent to Muse. Set <code>CHAR2D_FAKE_AI=0</code> in <code>.env</code> and restart <code>npm run dev</code> to generate for real.</p>}
    <main>{children}</main>
    <footer className="ground"><p><Image src="/brand/logo-hero.png" alt="" width={20} height={30} className="footer-mascot" />Char2D · Your characters are saved on this computer</p></footer>
  </Providers></body></html>;
}
