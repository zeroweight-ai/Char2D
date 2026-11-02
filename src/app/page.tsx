import Image from "next/image";
import { CharacterGallery } from "@/components/CharacterGallery";
import { TitleActions } from "@/components/TitleActions";
import { PixelIcon } from "@/components/PixelIcon";
const steps = [
  { icon: "upload", title: "Add a picture or an idea", text: "Upload a photo or drawing, or describe a character in words." },
  { icon: "star", title: "Approve the sheet", text: "Muse draws your character from the side, front and back. Accept it or ask for changes." },
  { icon: "sword", title: "Play and add moves", text: "Idle, walk, jump and crouch are made for you. Try them with your keyboard, then describe new moves." },
] as const;
export default function Home() {
  return <>
    <section className="title-screen full-bleed" aria-labelledby="game-title">
      <div className="title-stack">
        <h1 id="game-title" className="game-logo"><Image src="/brand/logo-full.png" alt="Char2D" width={900} height={732} priority className="bob-slow" /></h1>
      </div>
      <p className="title-tagline">One picture in. A playable pixel-art character out.</p>
      <TitleActions />
    </section>
    <CharacterGallery />
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title">How it works</h2>
      <ol className="levels">
        {steps.map((step, index) => <li className="panel level-card" key={step.title}><span className="level-no">{index + 1}</span><h3><PixelIcon name={step.icon} className="option-icon" />{step.title}</h3><p>{step.text}</p></li>)}
      </ol>
    </section>
  </>;
}
