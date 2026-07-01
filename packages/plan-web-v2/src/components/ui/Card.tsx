import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass p-8 ${className}`}>{children}</div>;
}

export function CardCompact({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass-compact p-5 ${className}`}>{children}</div>;
}
