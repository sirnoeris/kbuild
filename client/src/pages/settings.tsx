import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Edit2, Trash2, Loader2, CheckCircle2, XCircle,
  RefreshCw, Eye, EyeOff, Zap, ChevronDown, AlertCircle,
  Settings as SettingsIcon, Link2, Brain, FileType, Sliders, Globe, Search, ExternalLink
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Connection {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  type: string;
  isActive: boolean;
}

interface VaultSettings {
  processingConnectionId?: number;
  processingModel?: string;
  chatConnectionId?: number;
  chatModel?: string;
  autoScan: boolean;
  maxConcurrent: number;
  maxRetries: number;
  enabledFormats: string;
  vaultPath: string;
  webSearchEnabled: boolean;
  webSearchProvider: string;
  webSearchApiKey: string;
}

const FILE_FORMATS = [
  { key: "pdf", label: "PDF", desc: "Portable Document Format" },
  { key: "html", label: "HTML", desc: "Web pages" },
  { key: "docx", label: "Word (.docx)", desc: "Microsoft Word" },
  { key: "pptx", label: "PowerPoint (.pptx)", desc: "Presentations" },
  { key: "xlsx", label: "Excel (.xlsx)", desc: "Spreadsheets" },
  { key: "csv", label: "CSV", desc: "Comma-separated values" },
  { key: "md", label: "Markdown", desc: "Markdown files" },
  { key: "txt", label: "Text", desc: "Plain text" },
];

const CONNECTION_TYPES = [
  { value: "openai_compatible", label: "OpenAI-compatible" },
  { value: "xai", label: "xAI (Grok)" },
  { value: "custom_local", label: "Local (LM Studio / Ollama)" },
];

const PRESET_URLS: Record<string, string> = {
  openai_compatible: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  custom_local: "http://localhost:11434/v1",
};

type SettingsTab = "connections" | "models" | "formats" | "behavior" | "websearch";

const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "connections", label: "Connections", icon: <Link2 size={14} /> },
  { id: "models", label: "Models", icon: <Brain size={14} /> },
  { id: "formats", label: "Formats", icon: <FileType size={14} /> },
  { id: "behavior", label: "Behavior", icon: <Sliders size={14} /> },
  { id: "websearch", label: "Web Search", icon: <Globe size={14} /> },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("connections");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.125rem", fontWeight: 700, color: "var(--color-text)" }}>Settings</h1>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "1px" }}>Configure LLM connections, models, and behaviour</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Tab sidebar */}
        <div className="w-48 shrink-0 border-r py-3 px-2" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg mb-0.5 text-left transition-all"
              style={{
                background: activeTab === tab.id ? "var(--color-primary-highlight)" : "transparent",
                color: activeTab === tab.id ? "var(--color-primary)" : "var(--color-text-muted)",
                fontSize: "var(--text-sm)",
                fontFamily: "var(--font-body)",
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "connections" && <ConnectionsTab />}
          {activeTab === "models" && <ModelsTab />}
          {activeTab === "formats" && <FormatsTab />}
          {activeTab === "behavior" && <BehaviorTab />}
          {activeTab === "websearch" && <WebSearchTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Connections Tab ──────────────────────────────────────────────────────────

function ConnectionsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showKey, setShowKey] = useState<Record<number, boolean>>({});
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; error?: string; models?: string[] }>>({});

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ["/api/connections"],
    queryFn: () => apiRequest("GET", "/api/connections").then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/connections/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/connections"] });
      toast({ title: "Connection removed" });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/connections/${id}/test`).then(r => r.json()),
    onSuccess: (data, id) => {
      setTestResults(prev => ({ ...prev, [id]: data }));
      toast({ title: data.ok ? "Connection valid" : "Connection failed", description: data.ok ? `${data.models?.length ?? 0} models found` : data.error, variant: data.ok ? "default" : "destructive" });
    },
  });

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.95rem", color: "var(--color-text)" }}>LLM Connections</h2>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>OpenAI-compatible endpoints, xAI, and local models</p>
        </div>
        <Button size="sm" onClick={() => { setShowForm(true); setEditingId(null); }} data-testid="button-add-connection">
          <Plus size={13} className="mr-1.5" /> Add connection
        </Button>
      </div>

      {(showForm || editingId !== null) && (
        <ConnectionForm
          editingId={editingId}
          initial={editingId ? connections.find(c => c.id === editingId) : undefined}
          onClose={() => { setShowForm(false); setEditingId(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/connections"] }); setShowForm(false); setEditingId(null); }}
        />
      )}

      {connections.length === 0 && !showForm ? (
        <EmptyCard
          icon={<Link2 size={20} style={{ color: "var(--color-text-faint)" }} />}
          title="No connections yet"
          desc="Add an OpenRouter, OpenAI, xAI, or local endpoint to get started."
        />
      ) : connections.map(conn => (
        <div key={conn.id} data-testid={`connection-${conn.id}`} className="rounded-xl p-4"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "var(--color-primary-highlight)" }}>
              <Zap size={14} style={{ color: "var(--color-primary)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.85rem", color: "var(--color-text)" }}>{conn.name}</span>
                <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--color-surface-offset)", color: "var(--color-text-muted)" }}>
                  {CONNECTION_TYPES.find(t => t.value === conn.type)?.label ?? conn.type}
                </span>
              </div>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>{conn.baseUrl}</p>
              {conn.apiKey && (
                <div className="flex items-center gap-1 mt-1">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", fontFamily: "var(--font-mono)" }}>
                    {showKey[conn.id] ? conn.apiKey : conn.apiKey.slice(0, 12) + "••••"}
                  </span>
                  <button onClick={() => setShowKey(prev => ({ ...prev, [conn.id]: !prev[conn.id] }))}>
                    {showKey[conn.id] ? <EyeOff size={11} style={{ color: "var(--color-text-faint)" }} /> : <Eye size={11} style={{ color: "var(--color-text-faint)" }} />}
                  </button>
                </div>
              )}
              {testResults[conn.id] && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {testResults[conn.id].ok
                    ? <CheckCircle2 size={12} style={{ color: "var(--color-success)" }} />
                    : <XCircle size={12} style={{ color: "var(--color-error)" }} />}
                  <span style={{ fontSize: "var(--text-xs)", color: testResults[conn.id].ok ? "var(--color-success)" : "var(--color-error)" }}>
                    {testResults[conn.id].ok
                      ? `Connected · ${testResults[conn.id].models?.length ?? 0} models`
                      : testResults[conn.id].error?.slice(0, 80)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => testMutation.mutate(conn.id)} disabled={testMutation.isPending} data-testid={`button-test-${conn.id}`}>
                {testMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                <span className="ml-1 text-xs">Test</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditingId(conn.id)} data-testid={`button-edit-${conn.id}`}>
                <Edit2 size={12} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(conn.id)} data-testid={`button-delete-${conn.id}`}>
                <Trash2 size={12} style={{ color: "var(--color-error)" }} />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectionForm({ editingId, initial, onClose, onSaved }: {
  editingId: number | null;
  initial?: Connection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const defaultType = initial?.type ?? "openai_compatible";
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    baseUrl: initial?.baseUrl || PRESET_URLS[defaultType] || "",
    apiKey: initial?.apiKey ?? "",
    type: defaultType,
  });

  const saveMutation = useMutation({
    mutationFn: () => editingId
      ? apiRequest("PATCH", `/api/connections/${editingId}`, form).then(r => r.json())
      : apiRequest("POST", "/api/connections", form).then(r => r.json()),
    onSuccess: () => { toast({ title: editingId ? "Connection updated" : "Connection added" }); onSaved(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--color-surface-offset)", border: "1px solid var(--color-primary)", borderStyle: "dashed" }}>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.85rem", color: "var(--color-text)" }}>
        {editingId ? "Edit connection" : "New connection"}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Name">
          <input data-testid="input-conn-name" type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="OpenRouter main" className="settings-input" style={inputStyle} />
        </FormField>

        <FormField label="Type">
          <select value={form.type} onChange={e => {
            const t = e.target.value;
            const presetUrl = PRESET_URLS[t];
            setForm(p => ({ ...p, type: t, baseUrl: presetUrl ?? p.baseUrl }));
          }} className="settings-input" style={inputStyle}>
            {CONNECTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FormField>

        <FormField label="Base URL" className="col-span-2">
          <input data-testid="input-conn-url" type="text" value={form.baseUrl} onChange={e => setForm(p => ({ ...p, baseUrl: e.target.value }))}
            placeholder="https://openrouter.ai/api/v1" className="settings-input" style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }} />
        </FormField>

        <FormField label="API Key" className="col-span-2">
          {/* When editing, the server returns a masked key — show placeholder instead so user
              knows a key exists, and only submit if they type a new one. */}
          <input
            data-testid="input-conn-key"
            type="password"
            value={form.apiKey}
            onChange={e => setForm(p => ({ ...p, apiKey: e.target.value }))}
            placeholder={initial?.apiKey ? "Leave blank to keep existing key" : "sk-..."}
            className="settings-input"
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
          />
        </FormField>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!form.name || !form.baseUrl || saveMutation.isPending} data-testid="button-save-connection">
          {saveMutation.isPending ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
          {editingId ? "Update" : "Add connection"}
        </Button>
      </div>
    </div>
  );
}

// ─── Models Tab ───────────────────────────────────────────────────────────────

function ModelsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [loadingModels, setLoadingModels] = useState<Record<number, boolean>>({});
  const [availableModels, setAvailableModels] = useState<Record<number, string[]>>({});

  const { data: vault } = useQuery<VaultSettings>({
    queryKey: ["/api/vault"],
    queryFn: () => apiRequest("GET", "/api/vault").then(r => r.json()),
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ["/api/connections"],
    queryFn: () => apiRequest("GET", "/api/connections").then(r => r.json()),
  });

  const updateVault = useMutation({
    mutationFn: (data: Partial<VaultSettings>) => apiRequest("PATCH", "/api/vault", data).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vault"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const fetchModels = async (connId: number) => {
    setLoadingModels(prev => ({ ...prev, [connId]: true }));
    try {
      const models = await apiRequest("GET", `/api/connections/${connId}/models`).then(r => r.json());
      setAvailableModels(prev => ({ ...prev, [connId]: Array.isArray(models) ? models : [] }));
    } catch (e: any) {
      toast({ title: "Failed to fetch models", description: e.message, variant: "destructive" });
    } finally {
      setLoadingModels(prev => ({ ...prev, [connId]: false }));
    }
  };

  if (!vault) return <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>;
  if (connections.length === 0) return (
    <EmptyCard icon={<Brain size={20} style={{ color: "var(--color-text-faint)" }} />}
      title="No connections configured"
      desc="Add a connection first, then configure your processing and chat models." />
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.95rem", color: "var(--color-text)" }}>Model selection</h2>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
          Choose separate models for processing (raw → wiki) and chat
        </p>
      </div>

      {[
        { role: "processing" as const, label: "Processing model", desc: "Used to summarize raw files into wiki pages. Larger, more capable models produce better summaries.", connKey: "processingConnectionId" as const, modelKey: "processingModel" as const },
        { role: "chat" as const, label: "Chat model", desc: "Used to answer questions over the wiki. Can be a smaller, faster model.", connKey: "chatConnectionId" as const, modelKey: "chatModel" as const },
      ].map(({ role, label, desc, connKey, modelKey }) => {
        const selectedConnId = vault[connKey];
        const selectedModel = vault[modelKey];
        const models = selectedConnId ? (availableModels[selectedConnId] ?? []) : [];

        return (
          <div key={role} className="rounded-xl p-5" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
            <div className="mb-4">
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.85rem", color: "var(--color-text)" }}>{label}</h3>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "2px" }}>{desc}</p>
            </div>

            <div className="space-y-3">
              <FormField label="Connection">
                <select
                  data-testid={`select-${role}-connection`}
                  value={selectedConnId ?? ""}
                  onChange={e => updateVault.mutate({ [connKey]: e.target.value ? parseInt(e.target.value) : undefined })}
                  style={inputStyle}
                >
                  <option value="">— Select connection —</option>
                  {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>

              <FormField label="Model">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      data-testid={`input-${role}-model`}
                      type="text"
                      list={`models-${role}`}
                      value={selectedModel ?? ""}
                      onChange={e => updateVault.mutate({ [modelKey]: e.target.value })}
                      placeholder={selectedConnId ? "Type or select a model..." : "Select a connection first"}
                      disabled={!selectedConnId}
                      style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
                    />
                    <datalist id={`models-${role}`}>
                      {models.map(m => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                  {selectedConnId && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => fetchModels(selectedConnId)}
                      disabled={loadingModels[selectedConnId]}
                      data-testid={`button-refresh-${role}-models`}
                    >
                      {loadingModels[selectedConnId] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    </Button>
                  )}
                </div>
                {models.length > 0 && (
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--color-success)", marginTop: "4px" }}>
                    <CheckCircle2 size={10} style={{ display: "inline", marginRight: "4px" }} />
                    {models.length} models available
                  </p>
                )}
              </FormField>

              {selectedConnId && selectedModel && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "var(--color-primary-highlight)" }}>
                  <CheckCircle2 size={13} style={{ color: "var(--color-primary)" }} />
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-primary)", fontFamily: "var(--font-mono)" }}>
                    {connections.find(c => c.id === selectedConnId)?.name} · {selectedModel}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Formats Tab ──────────────────────────────────────────────────────────────

function FormatsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: vault } = useQuery<VaultSettings>({
    queryKey: ["/api/vault"],
    queryFn: () => apiRequest("GET", "/api/vault").then(r => r.json()),
  });

  const updateVault = useMutation({
    mutationFn: (data: Partial<VaultSettings>) => apiRequest("PATCH", "/api/vault", data).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vault"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const enabledFormats: string[] = vault ? JSON.parse(vault.enabledFormats ?? '[]') : [];

  const toggleFormat = (key: string) => {
    const next = enabledFormats.includes(key)
      ? enabledFormats.filter(f => f !== key)
      : [...enabledFormats, key];
    updateVault.mutate({ enabledFormats: JSON.stringify(next) });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.95rem", color: "var(--color-text)" }}>File formats</h2>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Choose which file types KBuild processes from your raw/ folder</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {FILE_FORMATS.map(fmt => (
          <div
            key={fmt.key}
            data-testid={`format-${fmt.key}`}
            onClick={() => toggleFormat(fmt.key)}
            className="flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all"
            style={{
              background: enabledFormats.includes(fmt.key) ? "var(--color-primary-highlight)" : "var(--color-surface)",
              border: `1px solid ${enabledFormats.includes(fmt.key) ? "var(--color-primary)" : "var(--color-border)"}`,
            }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: enabledFormats.includes(fmt.key) ? "var(--color-primary)" : "var(--color-surface-offset)" }}>
              <span style={{ fontSize: "0.65rem", fontWeight: 700, color: enabledFormats.includes(fmt.key) ? "white" : "var(--color-text-muted)", letterSpacing: "0.02em" }}>
                {fmt.key.toUpperCase().slice(0, 3)}
              </span>
            </div>
            <div>
              <p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text)" }}>{fmt.label}</p>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{fmt.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4" style={{ background: "var(--color-surface-offset)", border: "1px solid var(--color-border)" }}>
        <div className="flex items-start gap-2">
          <AlertCircle size={14} style={{ color: "var(--color-warning)", marginTop: "1px", flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-warning)" }}>Coming in a future update</p>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
              Images, audio, and video ingestion will be supported once multimodal extraction is stable.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Behavior Tab ─────────────────────────────────────────────────────────────

function BehaviorTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: vault } = useQuery<VaultSettings>({
    queryKey: ["/api/vault"],
    queryFn: () => apiRequest("GET", "/api/vault").then(r => r.json()),
  });

  const updateVault = useMutation({
    mutationFn: (data: Partial<VaultSettings>) => apiRequest("PATCH", "/api/vault", data).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/vault"] }); toast({ title: "Settings saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!vault) return <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.95rem", color: "var(--color-text)" }}>Behaviour</h2>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Control how KBuild scans and processes files</p>
      </div>

      <div className="rounded-xl divide-y" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
        <BehaviorRow
          label="Auto-detect changes"
          desc="Automatically scan raw/ for new and changed files"
          checked={vault.autoScan}
          onToggle={() => updateVault.mutate({ autoScan: !vault.autoScan })}
          testId="toggle-auto-scan"
        />

        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text)" }}>Max concurrent files</p>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>Files processed in parallel per batch</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateVault.mutate({ maxConcurrent: Math.max(1, vault.maxConcurrent - 1) })}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "var(--color-surface-offset)", color: "var(--color-text)" }}
              >−</button>
              <span data-testid="value-max-concurrent" style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", fontWeight: 600, color: "var(--color-text)", minWidth: "1.5rem", textAlign: "center" }}>
                {vault.maxConcurrent}
              </span>
              <button
                onClick={() => updateVault.mutate({ maxConcurrent: Math.min(10, vault.maxConcurrent + 1) })}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "var(--color-surface-offset)", color: "var(--color-text)" }}
              >+</button>
            </div>
          </div>
        </div>

        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text)" }}>Max retries per file</p>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>LLM call retry attempts before marking error</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateVault.mutate({ maxRetries: Math.max(1, vault.maxRetries - 1) })}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "var(--color-surface-offset)", color: "var(--color-text)" }}
              >−</button>
              <span data-testid="value-max-retries" style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem", fontWeight: 600, color: "var(--color-text)", minWidth: "1.5rem", textAlign: "center" }}>
                {vault.maxRetries}
              </span>
              <button
                onClick={() => updateVault.mutate({ maxRetries: Math.min(10, vault.maxRetries + 1) })}
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "var(--color-surface-offset)", color: "var(--color-text)" }}
              >+</button>
            </div>
          </div>
        </div>
      </div>

      {vault.vaultPath && (
        <div className="rounded-xl p-4" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
          <p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text)", marginBottom: "0.25rem" }}>Vault path</p>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
            {vault.vaultPath}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              const newPath = window.prompt("Enter new vault path:", vault.vaultPath);
              if (newPath) updateVault.mutate({ vaultPath: newPath });
            }}
          >
            Change vault
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function BehaviorRow({ label, desc, checked, onToggle, testId }: {
  label: string; desc: string; checked: boolean; onToggle: () => void; testId: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div>
        <p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text)" }}>{label}</p>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>{desc}</p>
      </div>
      <Switch data-testid={testId} checked={checked} onCheckedChange={onToggle} />
    </div>
  );
}

function FormField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-muted)" }}>{label}</label>
      {children}
    </div>
  );
}

function EmptyCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center py-12 text-center rounded-xl"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "var(--color-surface-offset)" }}>
        {icon}
      </div>
      <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, color: "var(--color-text)", marginBottom: "0.25rem" }}>{title}</h3>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", maxWidth: "32ch" }}>{desc}</p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.375rem",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text)",
  fontSize: "var(--text-sm)",
  outline: "none",
  fontFamily: "var(--font-body)",
};

// ─── Web Search Tab ───────────────────────────────────────────────────────────────
function WebSearchTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");

  const { data: vault } = useQuery<VaultSettings>({
    queryKey: ["/api/vault"],
    queryFn: () => apiRequest("GET", "/api/vault").then(r => r.json()),
  });

  const updateVault = useMutation({
    mutationFn: (data: Partial<VaultSettings>) => apiRequest("PATCH", "/api/vault", data).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vault"] }),
  });

  if (!vault) return null;

  const isEnabled = vault.webSearchEnabled ?? false;
  const provider = vault.webSearchProvider ?? "brave";
  const apiKey = vault.webSearchApiKey ?? "";

  const handleTest = async () => {
    setTestStatus("testing");
    setTestError("");
    try {
      const resp = await apiRequest("POST", "/api/web-search", {
        query: "current date",
        originalQuestion: "test",
        conversationId: 0,
      });
      if (resp.ok) {
        setTestStatus("ok");
      } else {
        const d = await resp.json();
        setTestError(d.error ?? "Unknown error");
        setTestStatus("error");
      }
    } catch (e: any) {
      setTestError(e.message);
      setTestStatus("error");
    }
  };

  const PROVIDERS = [
    {
      value: "brave",
      label: "Brave Search",
      desc: "Free tier: 2,000 queries/month. Real-time results including stock prices and news.",
      signupUrl: "https://api.search.brave.com/register",
      keyPlaceholder: "BSAxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
    {
      value: "serper",
      label: "Serper (Google)",
      desc: "Free tier: 2,500 queries. Google results with rich answer boxes — excellent for financial data.",
      signupUrl: "https://serper.dev",
      keyPlaceholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    },
  ];

  const selectedProvider = PROVIDERS.find(p => p.value === provider) ?? PROVIDERS[0];

  return (
    <div className="space-y-5">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.95rem", color: "var(--color-text)" }}>Web Search</h2>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "2px" }}>
          When enabled, KBuild can search the web for live data (stock prices, recent news) when your knowledge base doesn't have the answer.
          You'll be asked to approve each search before it runs.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="rounded-xl" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
        <BehaviorRow
          label="Enable web search"
          desc="Allow KBuild to suggest and perform live web searches when the KB lacks real-time data"
          checked={isEnabled}
          onToggle={() => updateVault.mutate({ webSearchEnabled: !isEnabled })}
          testId="toggle-web-search"
        />
      </div>

      {/* Provider + key (shown only when enabled) */}
      {isEnabled && (
        <>
          {/* Provider selector */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.85rem", color: "var(--color-text)" }}>Search provider</h3>
            </div>
            <div className="p-4 space-y-2">
              {PROVIDERS.map(p => (
                <label
                  key={p.value}
                  className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
                  style={{
                    background: provider === p.value ? "var(--color-primary-highlight)" : "var(--color-surface-offset)",
                    border: `1px solid ${provider === p.value ? "var(--color-primary)" : "var(--color-border)"}`,
                  }}
                >
                  <input
                    type="radio"
                    name="provider"
                    value={p.value}
                    checked={provider === p.value}
                    onChange={() => updateVault.mutate({ webSearchProvider: p.value })}
                    style={{ marginTop: "2px", accentColor: "var(--color-primary)" }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--color-text)" }}>{p.label}</span>
                      <a
                        href={p.signupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1"
                        style={{ fontSize: "var(--text-xs)", color: "var(--color-primary)" }}
                      >
                        Get free API key <ExternalLink size={10} />
                      </a>
                    </div>
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "2px" }}>{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* API key */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.85rem", color: "var(--color-text)" }}>API key</h3>
            </div>
            <div className="p-4 space-y-3">
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => updateVault.mutate({ webSearchApiKey: e.target.value })}
                  placeholder={selectedProvider.keyPlaceholder}
                  style={{ ...inputStyle, paddingRight: "2.5rem" }}
                />
                <button
                  onClick={() => setShowKey(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-text-faint)" }}
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              {/* Test button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTest}
                  disabled={!apiKey || testStatus === "testing"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium"
                  style={{
                    background: "var(--color-surface-offset)",
                    color: "var(--color-text-muted)",
                    opacity: !apiKey ? 0.5 : 1,
                    cursor: !apiKey ? "not-allowed" : "pointer",
                  }}
                >
                  {testStatus === "testing" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  Test connection
                </button>
                {testStatus === "ok" && (
                  <span className="flex items-center gap-1" style={{ fontSize: "var(--text-xs)", color: "var(--color-success)" }}>
                    <CheckCircle2 size={12} /> Connected
                  </span>
                )}
                {testStatus === "error" && (
                  <span className="flex items-center gap-1" style={{ fontSize: "var(--text-xs)", color: "var(--color-error)" }}>
                    <XCircle size={12} /> {testError.slice(0, 80)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
