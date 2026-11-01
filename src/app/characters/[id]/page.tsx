import { notFound } from "next/navigation";
import { CharacterSheet } from "@/components/CharacterSheet";
import { getCharacter } from "@/server/characters/repository";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function CharacterPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!getCharacter(id)) notFound();
  return <CharacterSheet id={id} />;
}
