import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FolderOpen, Play, RefreshCw, RotateCcw, AlertCircle,
  CheckCircle2, Clock, Loader2, FileText, FileSpreadsheet,
  FileCode, Globe, Presentation, X, Database, BookOpen, RefreshCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

type FileStatus = "pending" | "processing" | "done" | "error";
type FilterType = "all" | "pending" | "done" | "error";

interface KBFile {
  id: number;
  path: string;
  kind: string;
  status: FileStatus;
  size: number;
  errorMessage?: string;
  processedAt?: string;
  addedAt: string;
  title?: string;
  summary?: string;
}

interface VaultSettings {
  vaultPath: string;
  lastScanAt?: string;
  lastRunSummary?: string;
  autoScan: boolean;
}

function FileKindIcon({ kind }: { kind: string }) {
  const cls = "shrink-0";
  const size = 15;
  switch (kind) {
    case "pdf": return <FileText size={size} className={cls} style={{ color: "var(--color-error)" }} />;
    case "html": return <Globe size={size} className={cls} style={{ color: "var(--color-primary)" }} />;
    case "csv":
    case "xlsx": return <FileSpreadsheet size={size} className={cls} style={{ color: "var(--color-success)" }} />;
    case "docx": return <FileText size={size} className={cls} style={{ color: "var(--color-warning)" }} />;
    case "pptx": return <Presentation size={size} className={cls} style={{ color: "var(--color-warning)" }} />;
    case "md":
    case "txt": return <FileCode size={size} className={cls} style={{ color: "var(--color-text-muted)" }} />;
    default: return <FileText size={size} className={cls} style={{ color: "var(--color-text-faint)" }} />;
  }
}

function StatusBadge({ status }: { status: FileStatus }) {
  const config = {
    pending: { label: "Pending", cls: "badge-pending", icon: <Clock size={11} /> },
    processing: { label: "Processing", cls: "badge-processing", icon: <Loader2 size={11} className="animate-spin" /> },
    done: { label: "Done", cls: "badge-done", icon: <CheckCircle2 size={11} /> },
    error: { label: "Error", cls: "badge-error", icon: <AlertCircle size={11} /> },
  }[status];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium", config.cls)}
      style={{ fontSize: "var(--text-xs)" }}>
      {config.icon}
      {config.label}
    </span>
  );
}

function VaultChooser({ onChosen }: { onChosen: (path: string) => void }) {
  const [inputPath, setInputPath] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const chooseMutation = useMutation({
    mutationFn: (vaultPath: string) =>
      apiRequest("POST", "/api/vault/choose", { vaultPath }).then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/vault"] });
      qc.invalidateQueries({ queryKey: ["/api/files"] });
      onChosen(data.vaultPath);
      toast({ title: "Vault configured", description: `Using: ${data.vaultPath}` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md w-full text-center px-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "var(--color-primary-highlight)" }}>
          <Database size={28} style={{ color: "var(--color-primary)" }} />
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text)", marginBottom: "0.5rem" }}>
          Choose your Obsidian vault
        </h1>
        <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)", marginBottom: "2rem" }}>
          KBuild will watch your <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em", background: "var(--color-surface-offset)", padding: "0.1em 0.4em", borderRadius: "4px" }}>raw/</code> folder,
          compile a wiki in <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em", background: "var(--color-surface-offset)", padding: "0.1em 0.4em", borderRadius: "4px" }}>wiki/</code>,
          and power chat over your knowledge base.
        </p>
        <div className="flex gap-2">
          <input
            data-testid="input-vault-path"
            type="text"
            value={inputPath}
            onChange={e => setInputPath(e.target.value)}
            onKeyDown={e => e.key === "Enter" && inputPath.trim() && chooseMutation.mutate(inputPath.trim())}
            placeholder="/path/to/your/obsidian/vault"
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              outline: "none",
            }}
          />
          <Button
            data-testid="button-choose-vault"
            onClick={() => inputPath.trim() && chooseMutation.mutate(inputPath.trim())}
            disabled={!inputPath.trim() || chooseMutation.isPending}
          >
            {chooseMutation.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : <FolderOpen size={14} className="mr-1" />}
            Open
          </Button>
        </div>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", marginTop: "0.75rem" }}>
          The folder will be created if it doesn't exist. Sub-folders <code>raw/</code>, <code>wiki/</code> and <code>outputs/</code> will be added automatically.
        </p>
      </div>
    </div>
  );
}

export default function Library() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterType>("all");
  const [showErrorDetail, setShowErrorDetail] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: vault, isLoading: vaultLoading } = useQuery<VaultSettings>({
    queryKey: ["/api/vault"],
    queryFn: () => apiRequest("GET", "/api/vault").then(r => r.json()),
  });

  const { data: files = [], isLoading: filesLoading } = useQuery<KBFile[]>({
    queryKey: ["/api/files"],
    queryFn: () => apiRequest("GET", "/api/files").then(r => r.json()),
    refetchInterval: 3000,
  });

  const { data: status } = useQuery({
    queryKey: ["/api/status"],
    queryFn: () => apiRequest("GET", "/api/status").then(r => r.json()),
    refetchInterval: 1500,
  });
  const isProcessing = status?.isProcessing ?? false;

  // SSE for real-time updates
  useEffect(() => {
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (["file_done", "file_error", "processing_complete", "scan_complete"].includes(payload.event)) {
          qc.invalidateQueries({ queryKey: ["/api/files"] });
          qc.invalidateQueries({ queryKey: ["/api/status"] });
        }
        if (payload.event === "processing_complete") {
          toast({
            title: "Processing complete",
            description: `${payload.data.processed} processed, ${payload.data.errors} errors`,
          });
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/files/scan").then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/files"] });
      qc.invalidateQueries({ queryKey: ["/api/vault"] });
      toast({ title: "Scan complete", description: `${data.newCount} new, ${data.changedCount} changed (${data.total} total)` });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const processMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/files/process").then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/status"] });
      toast({ title: "Processing started", description: "Files are being compiled into your wiki..." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/files/${id}/retry`).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/files"] }),
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/files/${id}/reprocess`).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "Queued for reprocessing", description: "File reset to pending — click Process raw/ to regenerate its wiki page." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reprocessAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/files/reprocess-all").then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/files"] });
      toast({ title: "All files queued", description: `${data.count} files reset to pending. Click Process raw/ to regenerate all wiki pages.` });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const retryAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/files/reset-all").then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/files"] }),
  });

  const [, navigate] = useLocation();

  const syncWikiMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/wiki/sync").then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/wiki"] });
      toast({
        title: "Wiki synced — chat is ready",
        description: `${data.synced} pages indexed. Opening chat…`,
      });
      // Navigate to chat after a short delay so the toast is visible
      setTimeout(() => navigate("/chat"), 1200);
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  if (vaultLoading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin" style={{ color: "var(--color-text-faint)" }} /></div>;
  if (!vault?.vaultPath) return <VaultChooser onChosen={() => qc.invalidateQueries({ queryKey: ["/api/vault"] })} />;

  const pendingCount = files.filter(f => f.status === "pending").length;
  const errorCount = files.filter(f => f.status === "error").length;
  const doneCount = files.filter(f => f.status === "done").length;
  const processingCount = files.filter(f => f.status === "processing").length;

  const filtered = files.filter(f => {
    if (filter === "all") return true;
    if (filter === "pending") return f.status === "pending" || f.status === "processing";
    return f.status === filter;
  });

  const lastRun = vault.lastRunSummary ? JSON.parse(vault.lastRunSummary) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-center gap-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="flex-1">
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.125rem", fontWeight: 700, color: "var(--color-text)" }}>Library</h1>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "1px" }}>
            {vault.vaultPath.split("/").filter(Boolean).pop()} / raw
            {vault.lastScanAt && (
              <span> · Last scan {formatDistanceToNow(new Date(vault.lastScanAt), { addSuffix: true })}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "var(--color-warning-highlight)", color: "var(--color-warning)" }}>
              {pendingCount} pending
            </span>
          )}
          {errorCount > 0 && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "var(--color-error-highlight)", color: "var(--color-error)" }}>
              {errorCount} errors
            </span>
          )}
          <Button
            data-testid="button-scan"
            variant="outline"
            size="sm"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <RefreshCw size={13} className="mr-1.5" />}
            Scan raw/
          </Button>
          <Button
            data-testid="button-process"
            size="sm"
            onClick={() => processMutation.mutate()}
            disabled={isProcessing || pendingCount === 0 || processMutation.isPending}
          >
            {isProcessing
              ? <><Loader2 size={13} className="animate-spin mr-1.5" />Processing...</>
              : <><Play size={13} className="mr-1.5" />Process raw/</>}
          </Button>
          <Button
            data-testid="button-reprocess-all"
            variant="outline"
            size="sm"
            onClick={() => reprocessAllMutation.mutate()}
            disabled={reprocessAllMutation.isPending || isProcessing || files.length === 0}
            title="Reset all files to pending so they are fully reprocessed on the next run"
          >
            {reprocessAllMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <RefreshCcw size={13} className="mr-1.5" />}
            Reprocess all
          </Button>
          <Button
            data-testid="button-sync-wiki"
            variant="outline"
            size="sm"
            onClick={() => syncWikiMutation.mutate()}
            disabled={syncWikiMutation.isPending || isProcessing}
            title="Rebuild the chat search index from processed wiki files"
          >
            {syncWikiMutation.isPending ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <BookOpen size={13} className="mr-1.5" />}
            Sync wiki
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-6 py-3 flex items-center gap-6 border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-2)" }}>
        <Stat label="Total" value={files.length} />
        <Stat label="Done" value={doneCount} color="var(--color-success)" />
        <Stat label="Pending" value={pendingCount} color="var(--color-warning)" />
        {processingCount > 0 && <Stat label="Processing" value={processingCount} color="var(--color-primary)" />}
        {errorCount > 0 && <Stat label="Errors" value={errorCount} color="var(--color-error)" />}

        <div className="flex-1" />

        {/* Filter pills */}
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "var(--color-surface-offset)" }}>
          {(["all", "pending", "done", "error"] as FilterType[]).map(f => (
            <button
              key={f}
              data-testid={`filter-${f}`}
              onClick={() => setFilter(f)}
              className="px-3 py-1 rounded-md capitalize transition-all"
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: filter === f ? 600 : 400,
                background: filter === f ? "var(--color-surface)" : "transparent",
                color: filter === f ? "var(--color-text)" : "var(--color-text-muted)",
                boxShadow: filter === f ? "var(--shadow-sm)" : "none",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {errorCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => retryAllMutation.mutate()}
            disabled={retryAllMutation.isPending}
            style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}
          >
            <RotateCcw size={11} className="mr-1" /> Retry all errors
          </Button>
        )}
      </div>

      {/* File table */}
      <div className="flex-1 overflow-y-auto">
        {filesLoading ? (
          <div className="p-6 space-y-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="skeleton h-12 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} vaultPath={vault.vaultPath} />
        ) : (
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
                {["File", "Type", "Status", "Size", "Processed"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium"
                    style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-body)" }}>
                    {h}
                  </th>
                ))}
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(file => (
                <>
                  <tr
                    key={file.id}
                    data-testid={`row-file-${file.id}`}
                    style={{
                      borderBottom: "1px solid var(--color-border)",
                      background: showErrorDetail === file.id ? "var(--color-surface-offset)" : "transparent",
                      cursor: file.status === "error" ? "pointer" : "default",
                    }}
                    onMouseEnter={() => setHoveredRow(file.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => file.status === "error" && setShowErrorDetail(showErrorDetail === file.id ? null : file.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <FileKindIcon kind={file.kind} />
                        <div>
                          <div className="font-medium" style={{ fontSize: "var(--text-sm)", color: "var(--color-text)", fontFamily: "var(--font-body)" }}>
                            {file.title ?? file.path.split("/").pop()}
                          </div>
                          <div className="truncate max-w-xs" style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", fontFamily: "var(--font-mono)" }}>
                            {file.path}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="uppercase" style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", letterSpacing: "0.05em", fontWeight: 600 }}>
                        {file.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={file.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                        {file.size ? (file.size < 1024 ? "< 1KB" : `${Math.round(file.size / 1024)}KB`) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
                        {file.processedAt ? formatDistanceToNow(new Date(file.processedAt), { addSuffix: true }) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end" style={{ opacity: hoveredRow === file.id ? 1 : 0, transition: "opacity 150ms" }}>
                        {file.status === "error" && (
                          <button
                            data-testid={`button-retry-${file.id}`}
                            onClick={(e) => { e.stopPropagation(); retryMutation.mutate(file.id); }}
                            className="px-2 py-1 rounded text-xs font-medium"
                            style={{ background: "var(--color-error-highlight)", color: "var(--color-error)" }}
                          >
                            Retry
                          </button>
                        )}
                        {file.status !== "processing" && (
                          <button
                            data-testid={`button-reprocess-${file.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              reprocessMutation.mutate(file.id);
                            }}
                            disabled={reprocessMutation.isPending || isProcessing}
                            className="px-2 py-1 rounded text-xs font-medium flex items-center gap-1"
                            style={{ background: "var(--color-surface-offset)", color: "var(--color-text-muted)" }}
                            title="Discard wiki page and reprocess from scratch"
                          >
                            <RefreshCcw size={10} />
                            Reprocess
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {showErrorDetail === file.id && file.errorMessage && (
                    <tr key={`err-${file.id}`}>
                      <td colSpan={6} className="px-4 pb-3">
                        <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "var(--color-error-highlight)", border: "1px solid var(--color-error)" }}>
                          <AlertCircle size={13} style={{ color: "var(--color-error)", marginTop: "2px", flexShrink: 0 }} />
                          <pre className="text-xs flex-1 whitespace-pre-wrap" style={{ color: "var(--color-error)", fontFamily: "var(--font-mono)" }}>
                            {file.errorMessage}
                          </pre>
                          <button onClick={() => setShowErrorDetail(null)}>
                            <X size={13} style={{ color: "var(--color-error)" }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {lastRun && (
        <div className="px-6 py-2.5 border-t flex items-center gap-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
            Last run {formatDistanceToNow(new Date(lastRun.timestamp), { addSuffix: true })} —
            <span style={{ color: "var(--color-success)", marginLeft: "0.25rem" }}>{lastRun.processedCount} processed</span>
            {lastRun.errorCount > 0 && <span style={{ color: "var(--color-error)", marginLeft: "0.25rem" }}>, {lastRun.errorCount} errors</span>}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: color ?? "var(--color-text)", fontFamily: "var(--font-display)" }}>{value}</span>
    </div>
  );
}

function EmptyState({ filter, vaultPath }: { filter: FilterType; vaultPath: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-8">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: "var(--color-surface-offset)" }}>
        {filter === "error" ? <AlertCircle size={22} style={{ color: "var(--color-error)" }} />
          : <FolderOpen size={22} style={{ color: "var(--color-text-faint)" }} />}
      </div>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--color-text)", marginBottom: "0.5rem" }}>
        {filter === "all" ? "Drop files into raw/" : `No ${filter} files`}
      </h3>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", maxWidth: "36ch" }}>
        {filter === "all"
          ? `Add PDFs, markdown, HTML, CSV and more to ${vaultPath}/raw/ then click Scan.`
          : `No files with status "${filter}" right now.`}
      </p>
    </div>
  );
}
