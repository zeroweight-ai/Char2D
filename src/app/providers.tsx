"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  // Dropdown menus are <details class="menu">: close them on outside click or Escape.
  useEffect(() => {
    const closeAll = (keep?: Node | null) => document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach(menu => { if (!keep || !menu.contains(keep)) menu.open = false; });
    const pointer = (event: PointerEvent) => closeAll(event.target as Node);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") closeAll(); };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
