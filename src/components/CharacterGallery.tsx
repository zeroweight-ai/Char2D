"use client";
import { viewLabels } from "@/lib/manifest";
import Image from "next/image";
import Link from "next/link";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import type { CharacterDetail } from "@/lib/character";
import { DeleteButton } from "./DeleteButton";
export function CharacterGallery() {
  const client=useQueryClient();
  const query=useQuery<CharacterDetail[]>({queryKey:["characters"],queryFn:async()=>{const r=await fetch("/api/characters");if(!r.ok)throw new Error("Could not load characters");return r.json();},refetchInterval:query=>query.state.data?.some(c=>c.status==="generating") ? 3000:false});
  return <section className="panel"><h2>Your characters</h2>{query.isPending?<p>Loading characters…</p>:query.isError?<p className="error">{query.error.message}</p>:!query.data.length?<p className="muted">No characters yet. Upload an image or describe your first character.</p>:<div className="grid">{query.data.map(character=><article className="character-card" key={character.id}><Link href={`/characters/${character.id}`}>{character.sheet?.processedAssetId&&<div className="checker"><Image src={`/api/assets/${character.sheet.processedAssetId}`} alt={`${character.name} sheet preview`} width={300} height={200} unoptimized className="pixel-preview"/></div>}<h3>{character.name}</h3><p className="muted">{viewLabels[character.viewType]} · {character.status==="generating"?"Generating…":character.status==="error"?"Needs attention":character.status==="ready"?"Animations ready":character.sheet?.status==="accepted"?"Sheet accepted":"Review sheet"}</p></Link><DeleteButton label="Delete character" title={`Delete ${character.name}?`} description="This permanently deletes the character, its sheets, actions, chat history, and saved assets. This cannot be undone." endpoint={`/api/characters/${character.id}`} onDeleted={async()=>{client.removeQueries({queryKey:["character",character.id]});await client.invalidateQueries({queryKey:["characters"]});}}/></article>)}</div>}</section>;
}
