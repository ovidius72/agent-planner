import type { HTMLAttributes, ReactNode } from "react";

export function CompactCard({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`surface-card p-4 ${className}`} {...props}>
      {children}
    </div>
  );
}
