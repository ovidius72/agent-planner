import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantClasses: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "",
  ghost: "btn-ghost",
  danger: "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20",
};

export function Button({ variant = "secondary", className = "", children, ...props }: Props) {
  return (
    <button className={`btn ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
