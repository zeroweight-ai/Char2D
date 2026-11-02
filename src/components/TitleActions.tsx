"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { CharacterDetail } from "@/lib/character";
// One clear primary action; "continue" only appears once there is something to continue.
export function TitleActions() {
  const query=useQuery<CharacterDetail[]>({queryKey:["characters"],queryFn:async()=>{const r=await fetch("/api/characters");if(!r.ok)throw new Error("Could not load characters");return r.json();}});
  const count=query.data?.length??0;
  return <div className="title-actions">
    <Link className="button big" href="/create">▶ Create a character</Link>
    {count>0&&<Link className="button big secondary" href="#party">My characters ({count})</Link>}
  </div>;
}
