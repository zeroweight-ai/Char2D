"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CharacterDetail } from "@/lib/character";
import { PixelIcon } from "./PixelIcon";
import { PlaygroundWorld } from "./PlaygroundWorld";

const MAP_NAME = "Market Adventure";

export function Playground() {
  const dialog = useRef<HTMLDialogElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const [session, setSession] = useState<{ character: CharacterDetail; run: number } | null>(null);
  const query = useQuery<CharacterDetail[]>({
    queryKey: ["characters"],
    queryFn: async () => {
      const response = await fetch("/api/characters");
      if (!response.ok) throw new Error("Could not load your characters.");
      return response.json();
    },
    refetchInterval: query => query.state.data?.some(character => character.status === "generating") ? 3000 : false,
  });
  // A published atlas can remain playable while an additional move generates.
  const playable = query.data?.filter(character => character.manifest && Object.values(character.manifest.actions).some(action => action.directions.right || action.directions.left)) ?? [];
  const selected = playable.find(character => character.id === selectedId);
  const pending = query.data?.some(character => character.status === "generating");

  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);

  function chooseCharacter() {
    setSelectedId(session?.character.id ?? selectedId);
    dialog.current?.showModal();
  }

  function confirm() {
    if (!selected) return;
    setSession(current => ({ character: selected, run: (current?.run ?? 0) + 1 }));
    dialog.current?.close();
  }

  return <>
    <span className="eyebrow">Let’s play</span>
    <h1>Playground</h1>
    <p className="lead">Choose your character and jump into Market Adventure.</p>
    {session ? <>
      <div className="panel-title playground-toolbar">
        <div><span className="kicker">Playing as {session.character.name}</span><h2>{MAP_NAME}</h2></div>
        <div className="button-row"><button className="secondary small" onClick={chooseCharacter}>Change character</button></div>
      </div>
      <PlaygroundWorld key={`${session.run}:${session.character.id}`} character={query.data?.find(character => character.id === session.character.id) ?? session.character} world={MAP_NAME} onReplay={() => setSession(current => current ? { ...current, run: current.run + 1 } : null)} />
    </> : <section className="panel" aria-label="Start playing">
      <h2>Choose your hero</h2>
      <p>Explore the village, collect its treasure, and defeat the Goblin Soldier.</p>
      <button ref={chooseButton} onClick={chooseCharacter}>Choose character</button>
    </section>}

    <dialog ref={dialog} className="character-picker" aria-labelledby="character-picker-title" aria-describedby="character-picker-description" onClose={() => { if (!session) chooseButton.current?.focus({ preventScroll: true }); }}>
      <span className="kicker">{MAP_NAME}</span>
      <h2 id="character-picker-title">Choose your character</h2>
      <p id="character-picker-description">Select a generated hero to explore Market Adventure.</p>
      {query.isPending ? <p role="status">Loading your characters…</p> : query.isError ? <div role="alert"><p className="error">{query.error.message}</p><button className="secondary small" onClick={() => void query.refetch()}>Try again</button></div> : playable.length === 0 ? <div className="picker-empty">
        <h3>No playable characters yet</h3><p>{pending ? "Your characters are still generating. They will appear here when their animations are ready." : "Create a character and accept its sheet to generate playable animations."}</p><Link className="button" href="/create">Create a character</Link>
      </div> : <fieldset className="character-options"><legend className="sr-only">Generated characters</legend>{playable.map(character => <label className="character-option" key={character.id}>
        <input type="radio" name="playground-character" value={character.id} checked={selectedId === character.id} onChange={() => setSelectedId(character.id)} />
        <span className="character-option-preview checker">{character.sheet?.processedAssetId ? <Image src={`/api/assets/${character.sheet.processedAssetId}`} alt={`${character.name} preview`} width={240} height={150} unoptimized className="pixel-preview" /> : <PixelIcon name="sword" className="option-icon" />}</span>
        <strong>{character.name}</strong><small>{Object.keys(character.manifest!.actions).length} moves ready</small>
      </label>)}</fieldset>}
      <div className="button-row picker-footer"><button autoFocus className="secondary" onClick={() => dialog.current?.close()}>Cancel</button><button disabled={!selected || query.isError || query.isPending} onClick={confirm}>Start playing</button></div>
    </dialog>
  </>;
}
