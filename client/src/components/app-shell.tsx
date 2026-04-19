import { Link, useLocation } from "wouter";
import { useTheme } from "./theme-provider";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Library, MessageSquare, Settings, Sun, Moon,
  FolderOpen, Activity, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  testId: string;
}

const nav: NavItem[] = [
  { href: "/", icon: <Library size={18} />, label: "Library", testId: "nav-library" },
  { href: "/chat", icon: <MessageSquare size={18} />, label: "Chat", testId: "nav-chat" },
  { href: "/settings", icon: <Settings size={18} />, label: "Settings", testId: "nav-settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  const { data: vault } = useQuery({
    queryKey: ["/api/vault"],
    queryFn: () => apiRequest("GET", "/api/vault").then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: status } = useQuery({
    queryKey: ["/api/status"],
    queryFn: () => apiRequest("GET", "/api/status").then(r => r.json()),
    refetchInterval: 2000,
  });

  const isProcessing = status?.isProcessing;

  const vaultName = vault?.vaultPath
    ? vault.vaultPath.split("/").filter(Boolean).pop() ?? "vault"
    : null;

  const isActive = (href: string) => {
    if (href === "/") return location === "/" || location === "";
    return location.startsWith(href);
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--color-bg)" }}>
      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="w-[220px] shrink-0 flex flex-col border-r" style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <Link href="/">
            <div className="flex items-center gap-2.5 group cursor-pointer">
              <svg aria-label="KBuild" width="28" height="28" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="6" fill="var(--color-primary)" opacity="0.15" />
                <path d="M8 10h10M8 15.5h16M8 21h12" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="24" cy="10" r="3.5" fill="var(--color-primary)" />
              </svg>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1rem", color: "var(--color-text)", letterSpacing: "-0.02em" }}>
                KBuild
              </span>
            </div>
          </Link>
        </div>

        {/* Vault indicator */}
        {vault && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-md flex items-center gap-2" style={{ background: "var(--color-surface-offset)", border: "1px solid var(--color-border)" }}>
            <FolderOpen size={13} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
            <span className="truncate" style={{ fontSize: "var(--text-xs)", color: vault.vaultPath ? "var(--color-text-muted)" : "var(--color-text-faint)" }}>
              {vaultName ?? "No vault selected"}
            </span>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 pt-4 flex flex-col gap-0.5">
          {nav.map(item => (
            <Link key={item.href} href={item.href}>
              <div
                data-testid={item.testId}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-all",
                  isActive(item.href)
                    ? "font-medium"
                    : "hover:opacity-80"
                )}
                style={{
                  background: isActive(item.href) ? "var(--color-primary-highlight)" : "transparent",
                  color: isActive(item.href) ? "var(--color-primary)" : "var(--color-text-muted)",
                  fontSize: "var(--text-sm)",
                  fontFamily: "var(--font-body)",
                }}
              >
                {item.icon}
                {item.label}
              </div>
            </Link>
          ))}
        </nav>

        {/* Status + Theme toggle */}
        <div className="px-3 pb-4 flex flex-col gap-2">
          {isProcessing && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: "var(--color-primary-highlight)", fontSize: "var(--text-xs)", color: "var(--color-primary)" }}>
              <Loader2 size={12} className="animate-spin" />
              Processing...
            </div>
          )}
          <button
            data-testid="button-theme-toggle"
            onClick={toggle}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md w-full hover:opacity-80"
            style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
