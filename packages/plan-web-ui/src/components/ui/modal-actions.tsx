import type { HTMLAttributes, ReactNode } from "react";

export function ModalActions({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`sticky bottom-0 mt-2 flex justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-1 pt-4 pb-1 backdrop-blur-xl ${className}`} {...props}>
      {children}
    </div>
  );
}
