import Link from "next/link";
import { CharacterGallery } from "@/components/CharacterGallery";
import { DemoJob } from "@/components/DemoJob";
export default function Home() {
  return <><section className="hero"><span className="eyebrow">One image. A world of possibilities.</span><h1>Your next character<br />starts here.</h1><p className="lead">Turn a photo or drawing into a pixel-art character. Animate it, give it new moves, and bring it into your game.</p><Link className="button" href="/create">Create a character →</Link><span className="badge">Development preview</span></section>
  <section className="grid" aria-label="Workflow"><article className="panel"><h2>01 · Make it yours</h2><p>Start with an image and choose a side-scroller or top-down character.</p></article><article className="panel"><h2>02 · Give it motion</h2><p>Generate action strips, then refine poses and timing through chat.</p></article><article className="panel"><h2>03 · Press play</h2><p>Map your moves to buttons and explore a sample world.</p></article></section>
  <CharacterGallery /><DemoJob /></>;
}
