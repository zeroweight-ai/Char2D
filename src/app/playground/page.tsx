import Link from "next/link";
import { PixelIcon } from "@/components/PixelIcon";
const nodes = [
  { name: "Meadow Run", kind: "Side-scroller world", x: 33, y: 52 },
  { name: "Village Square", kind: "Top-down world", x: 50, y: 78 },
  { name: "Castle Keep", kind: "Coming later", x: 30, y: 17 },
];
export default function PlaygroundPage() {
  return <>
    <span className="eyebrow">World map</span>
    <h1>A place for your pixels.</h1>
    <p className="lead">Your heroes will explore these worlds using the same atlas manifest you see in the training ground.</p>
    <section className="world-map" aria-label="World map preview">
      {nodes.map(node => <div className="map-node" key={node.name} style={{ left: `${node.x}%`, top: `${node.y}%` }}><span className="pin"><PixelIcon name="lock" className="pin-icon" /></span><span className="label">{node.name}<small>{node.kind}</small></span></div>)}
    </section>
    <section className="panel"><span className="kicker">Locked</span><h2>Worlds are coming in Phase 5</h2><p>The planned side-scroller and top-down worlds will use your characters’ shared atlas manifest. Until then, test-drive moves in each hero’s training ground.</p><Link className="button" href="/#party">Go to your party</Link></section>
  </>;
}
