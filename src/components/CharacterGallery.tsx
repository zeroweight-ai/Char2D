"use client";
import Image from "next/image";
import Link from "next/link";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import type { CharacterDetail } from "@/lib/character";
import { DeleteButton } from "./DeleteButton";
export function heroStatus(character:CharacterDetail):{label:string;tone:"ready"|"running"|"error"|""} {
  if(character.status==="generating")return {label:character.sheet?.status==="accepted"?"Animating…":"Drawing sheet…",tone:"running"};
  if(character.status==="error")return {label:"Needs attention",tone:"error"};
  if(character.status==="ready")return {label:"Ready to play",tone:"ready"};
  return {label:character.sheet?.status==="accepted"?"Sheet accepted":"Review the sheet",tone:"running"};
}
export function CharacterGallery() {
  const client=useQueryClient();
  const query=useQuery<CharacterDetail[]>({queryKey:["characters"],queryFn:async()=>{const r=await fetch("/api/characters");if(!r.ok)throw new Error("Could not load characters");return r.json();},refetchInterval:query=>query.state.data?.some(c=>c.status==="generating") ? 3000:false});
  return <section id="party" className="party" aria-labelledby="party-title">
    <div className="section-head"><h2 id="party-title">My characters</h2></div>
    {query.isPending?<p className="panel">Loading your characters…</p>:query.isError?<p className="panel error">{query.error.message}</p>:!query.data.length?<div className="panel empty-party">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative pixel sprite */}
      <img className="sprite" src="/game/sprite-chest.png" alt="" width={120} height={119} />
      <div><h3>No characters yet</h3><p className="muted">Start with a picture or a short description. It takes a few minutes.</p><Link className="button" href="/create">▶ Create your first character</Link></div>
    </div>:<div className="slots">{query.data.map(character=>{
      const status=heroStatus(character);const moves=character.animation?.actions.length??0;
      return <article className="panel character-card" key={character.id}><Link href={`/characters/${character.id}`} className="card-link">
        <div className="checker">{character.sheet?.processedAssetId?<Image src={`/api/assets/${character.sheet.processedAssetId}`} alt={`${character.name} sheet preview`} width={300} height={200} unoptimized className="pixel-preview"/>:<span className="muted">…</span>}</div>
        <h3>{character.name}</h3>
        <div className="stats"><span className={`pill ${status.tone}`}>{status.label}</span>{moves>0&&<span className="muted">{moves} move{moves===1?"":"s"}</span>}</div>
      </Link><DeleteButton quiet text="Delete" label="Delete character" title={`Delete ${character.name}?`} description="This permanently deletes the character, its sheets, moves and saved images. This cannot be undone." endpoint={`/api/characters/${character.id}`} onDeleted={async()=>{client.removeQueries({queryKey:["character",character.id]});await client.invalidateQueries({queryKey:["characters"]});}}/></article>;
    })}<Link className="slot-empty" href="/create"><span className="plus" aria-hidden="true">+</span>New character</Link></div>}
  </section>;
}
