import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: "var(--color-surface-offset)" }}>
          <FileQuestion size={24} style={{ color: "var(--color-text-faint)" }} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--color-text)", marginBottom: "0.5rem" }}>
          Page not found
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", marginBottom: "1.5rem" }}>
          This page doesn't exist.
        </p>
        <Link href="/">
          <Button variant="outline">Go to Library</Button>
        </Link>
      </div>
    </div>
  );
}
