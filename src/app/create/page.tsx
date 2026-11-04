import { CreateCharacter } from "@/components/CreateCharacter";
export default function CreatePage() {
  return <>
    <section className="scene-banner compact" style={{"--scene":"url(/game/summon-shrine.png)"} as React.CSSProperties}>
      <h1>Create a character</h1>
      <p className="lead">Start from a picture or an idea, or restore a character from an exported ZIP.</p>
    </section>
    <CreateCharacter />
  </>;
}
