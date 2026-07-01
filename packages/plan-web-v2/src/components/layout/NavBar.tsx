import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Layers, Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/use-theme";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/features", label: "Features", icon: Layers },
];

export function NavBar() {
  const location = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)] backdrop-blur-[20px]">
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-1">
          <Link to="/" className="mr-4 text-sm font-bold tracking-tight">Agent Plan</Link>
          {links.map((link) => {
            const active = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                <link.icon size={16} />
                {link.label}
              </Link>
            );
          })}
        </div>
        <button onClick={toggle} className="btn btn-ghost p-2">
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
