import { CreateCharacter } from "@/components/CreateCharacter";
export default function CreatePage() {
  return <>
    <section className="scene-banner compact" style={{"--scene":"url(/game/summon-shrine.png)"} as React.CSSProperties}>
      <h1>Create a character</h1>
      <p className="lead">Two quick steps. You’ll see the result and approve it before anything gets animated.</p>
    </section>
    <CreateCharacter />
  </>;
}
