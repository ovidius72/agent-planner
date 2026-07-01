import type { ReactNode } from "react";
import { NavBar } from "./NavBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen">
      <NavBar />
      <main className="mx-auto w-full max-w-[1120px] px-6 py-8">
        {children}
      </main>
    </div>
  );
}
