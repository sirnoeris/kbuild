import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, Plus, Send, Loader2, BookOpen, Pin, PinOff,
  Trash2, ChevronRight, Bot, User, X, FileText, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Conversation {
  id: number;
  title: string;
  pinnedFiles: string;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  contextFiles?: string;
  createdAt: string;
}

interface WikiPage {
  id: number;
  path: string;
  title: string;
  type: string;
  summary: string;
}

export default function Chat() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [selectedConvId, setSelectedConvId] = useState<number | null>(params.id ? parseInt(params.id) : null);
  const [previewWiki, setPreviewWiki] = useState<WikiPage & { rawContent?: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    queryFn: () => apiRequest("GET", "/api/conversations").then(r => r.json()),
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/conversations", selectedConvId, "messages"],
    queryFn: () => apiRequest("GET", `/api/conversations/${selectedConvId}/messages`).then(r => r.json()),
    enabled: !!selectedConvId,
  });

  const selectedConv = conversations.find(c => c.id === selectedConvId);
  const pinnedFiles: string[] = selectedConv ? JSON.parse(selectedConv.pinnedFiles ?? "[]") : [];

  const lastContextFiles: string[] = (() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && m.contextFiles);
    if (!lastAssistant?.contextFiles) return [];
    try { return JSON.parse(lastAssistant.contextFiles); } catch { return []; }
  })();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (params.id) {
      setSelectedConvId(parseInt(params.id));
    } else if (!selectedConvId && conversations.length > 0) {
      // Auto-select the most recent conversation when opening Chat with no ID
      const latest = [...conversations].sort((a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
      )[0];
      setSelectedConvId(latest.id);
    }
  }, [params.id, conversations]);

  const createConvMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/conversations", { title: "New conversation" }).then(r => r.json()),
    onSuccess: (conv: Conversation) => {
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      setSelectedConvId(conv.id);
      navigate(`/chat/${conv.id}`);
    },
  });

  const deleteConvMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conversations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      setSelectedConvId(null);
      navigate("/chat");
    },
  });

  const chatMutation = useMutation({
    mutationFn: ({ convId, message }: { convId: number; message: string }) =>
      apiRequest("POST", `/api/conversations/${convId}/chat`, { message }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/conversations", selectedConvId, "messages"] });
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
    onError: (e: any) => toast({ title: "Chat error", description: e.message, variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: ({ convId, files }: { convId: number; files: string[] }) =>
      apiRequest("PATCH", `/api/conversations/${convId}`, { pinnedFiles: JSON.stringify(files) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/conversations"] }),
  });

  const handleSend = async () => {
    if (!input.trim() || chatMutation.isPending) return;
    let convId = selectedConvId;
    if (!convId) {
      const conv = await apiRequest("POST", "/api/conversations", { title: input.slice(0, 60) }).then(r => r.json());
      qc.invalidateQueries({ queryKey: ["/api/conversations"] });
      convId = conv.id;
      setSelectedConvId(convId);
      navigate(`/chat/${convId}`);
    }
    const msg = input;
    setInput("");
    chatMutation.mutate({ convId, message: msg });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const togglePin = (filePath: string) => {
    if (!selectedConvId) return;
    const newPins = pinnedFiles.includes(filePath)
      ? pinnedFiles.filter(p => p !== filePath)
      : [...pinnedFiles, filePath];
    pinMutation.mutate({ convId: selectedConvId, files: newPins });
  };

  const openWikiPreview = async (path: string) => {
    try {
      const page = await apiRequest("GET", `/api/wiki/page?path=${encodeURIComponent(path)}`).then(r => r.json());
      setPreviewWiki(page);
    } catch {}
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Conversation list ──────────────────────── */}
      <div className="w-[220px] shrink-0 flex flex-col border-r" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="p-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <Button
            data-testid="button-new-conversation"
            className="w-full justify-start gap-2"
            variant="outline"
            size="sm"
            onClick={() => createConvMutation.mutate()}
            disabled={createConvMutation.isPending}
          >
            <Plus size={13} />
            New chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {conversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Sparkles size={20} style={{ color: "var(--color-text-faint)", margin: "0 auto 0.5rem" }} />
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}>No conversations yet</p>
            </div>
          ) : conversations.map(conv => (
            <div
              key={conv.id}
              data-testid={`conv-item-${conv.id}`}
              className={cn(
                "group flex items-center gap-2 px-3 py-2.5 cursor-pointer relative",
                selectedConvId === conv.id ? "font-medium" : ""
              )}
              style={{
                background: selectedConvId === conv.id ? "var(--color-primary-highlight)" : "transparent",
                color: selectedConvId === conv.id ? "var(--color-primary)" : "var(--color-text-muted)",
              }}
              onClick={() => { setSelectedConvId(conv.id); navigate(`/chat/${conv.id}`); }}
            >
              <MessageSquare size={13} className="shrink-0" />
              <span className="flex-1 truncate" style={{ fontSize: "var(--text-xs)" }}>{conv.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConvMutation.mutate(conv.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--color-text-faint)" }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main chat area ────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedConvId ? (
          <ChatWelcome onCreate={() => createConvMutation.mutate()} />
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messagesLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin" style={{ color: "var(--color-text-faint)" }} /></div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Bot size={32} style={{ color: "var(--color-text-faint)", marginBottom: "1rem" }} />
                  <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
                    Ask anything about your knowledge base
                  </p>
                  <p style={{ color: "var(--color-text-faint)", fontSize: "var(--text-xs)", marginTop: "0.5rem" }}>
                    Answers will cite wiki files used as sources
                  </p>
                </div>
              ) : messages.map(msg => (
                <ChatMessage key={msg.id} message={msg} onClickSource={openWikiPreview} />
              ))}

              {chatMutation.isPending && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--color-primary-highlight)" }}>
                    <Bot size={14} style={{ color: "var(--color-primary)" }} />
                  </div>
                  <div className="msg-assistant px-4 py-3 flex items-center gap-2">
                    <div className="flex gap-1">
                      {[0,1,2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full processing-dot"
                          style={{ background: "var(--color-text-muted)", animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
              {pinnedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pinnedFiles.map(p => (
                    <div key={p} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                      style={{ background: "var(--color-primary-highlight)", color: "var(--color-primary)" }}>
                      <Pin size={10} />
                      <span className="truncate max-w-[140px]">{p.split("/").pop()?.replace(".md", "")}</span>
                      <button onClick={() => togglePin(p)}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  data-testid="input-chat"
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your knowledge base… (Enter to send, Shift+Enter for newline)"
                  rows={1}
                  className="flex-1 resize-none px-3 py-2.5 rounded-xl text-sm"
                  style={{
                    background: "var(--color-surface-offset)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                    outline: "none",
                    fontFamily: "var(--font-body)",
                    fontSize: "var(--text-sm)",
                    minHeight: "42px",
                    maxHeight: "160px",
                    lineHeight: "1.5",
                  }}
                  onInput={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 160) + "px";
                  }}
                />
                <Button
                  data-testid="button-send"
                  size="sm"
                  onClick={handleSend}
                  disabled={!input.trim() || chatMutation.isPending}
                  className="rounded-xl h-[42px] w-[42px] p-0 shrink-0"
                >
                  {chatMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Context panel ─────────────────────────── */}
      {selectedConvId && (
        <div className="w-[240px] shrink-0 border-l flex flex-col" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "0.8rem", fontWeight: 700, color: "var(--color-text)" }}>
              Context sources
            </h3>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)", marginTop: "1px" }}>
              Wiki files used for last answer
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            {lastContextFiles.length === 0 ? (
              <div className="py-6 text-center">
                <BookOpen size={18} style={{ color: "var(--color-text-faint)", margin: "0 auto 0.5rem" }} />
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)" }}>
                  Sources will appear here after a response
                </p>
              </div>
            ) : lastContextFiles.map(path => (
              <ContextFileCard
                key={path}
                path={path}
                isPinned={pinnedFiles.includes(path)}
                onPin={() => togglePin(path)}
                onPreview={() => openWikiPreview(path)}
              />
            ))}
          </div>

          {/* Pinned section */}
          {pinnedFiles.length > 0 && (
            <div className="border-t px-3 py-2" style={{ borderColor: "var(--color-border)" }}>
              <p style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                Pinned (always in context)
              </p>
              {pinnedFiles.map(path => (
                <ContextFileCard
                  key={path}
                  path={path}
                  isPinned
                  onPin={() => togglePin(path)}
                  onPreview={() => openWikiPreview(path)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wiki preview drawer */}
      {previewWiki && (
        <WikiPreview page={previewWiki} onClose={() => setPreviewWiki(null)} />
      )}
    </div>
  );
}

function ChatMessage({ message, onClickSource }: { message: Message; onClickSource: (path: string) => void }) {
  const contextFiles: string[] = (() => {
    if (!message.contextFiles) return [];
    try { return JSON.parse(message.contextFiles); } catch { return []; }
  })();

  return (
    <div className={cn("flex items-start gap-3", message.role === "user" ? "flex-row-reverse" : "")}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{
        background: message.role === "user" ? "var(--color-primary)" : "var(--color-surface-offset)",
        border: message.role === "assistant" ? "1px solid var(--color-border)" : "none",
      }}>
        {message.role === "user"
          ? <User size={13} style={{ color: "white" }} />
          : <Bot size={13} style={{ color: "var(--color-primary)" }} />}
      </div>

      <div className="flex-1 max-w-[85%]">
        <div className={cn("px-4 py-3", message.role === "user" ? "msg-user" : "msg-assistant prose")} style={{ maxWidth: "100%" }}>
          {message.role === "user"
            ? <p style={{ color: "white", fontSize: "var(--text-sm)", margin: 0 }}>{message.content}</p>
            : <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>}
        </div>

        {message.role === "assistant" && contextFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {contextFiles.map(p => (
              <button
                key={p}
                onClick={() => onClickSource(p)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:opacity-80 transition-opacity"
                style={{ background: "var(--color-surface-offset)", border: "1px solid var(--color-border)", fontSize: "0.7rem", color: "var(--color-text-muted)" }}
              >
                <FileText size={10} />
                {p.split("/").pop()?.replace(".md", "")}
              </button>
            ))}
          </div>
        )}

        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", marginTop: "0.25rem", textAlign: message.role === "user" ? "right" : "left" }}>
          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

function ContextFileCard({ path, isPinned, onPin, onPreview }: { path: string; isPinned: boolean; onPin: () => void; onPreview: () => void; }) {
  const name = path.split("/").pop()?.replace(".md", "") ?? path;
  const type = path.includes("/sources/") ? "source" : path.includes("/topics/") ? "topic" : "file";

  return (
    <div className="group flex items-start gap-2 p-2 rounded-lg mb-1.5 cursor-pointer hover:opacity-80 transition-opacity"
      style={{ background: "var(--color-surface-offset)", border: "1px solid var(--color-border)" }}
      onClick={onPreview}
      data-testid={`context-file-${name}`}
    >
      <FileText size={12} className="shrink-0 mt-0.5" style={{ color: "var(--color-primary)" }} />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium" style={{ fontSize: "0.7rem", color: "var(--color-text)" }}>{name}</p>
        <p style={{ fontSize: "0.65rem", color: "var(--color-text-faint)", textTransform: "capitalize" }}>{type}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onPin(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: isPinned ? "var(--color-primary)" : "var(--color-text-faint)" }}
      >
        {isPinned ? <Pin size={11} /> : <PinOff size={11} />}
      </button>
    </div>
  );
}

function WikiPreview({ page, onClose }: { page: WikiPage & { rawContent?: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-4" style={{ background: "hsl(222 24% 9% / 0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-[520px] h-[80vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: "var(--color-border)" }}>
          <BookOpen size={16} style={{ color: "var(--color-primary)" }} />
          <div className="flex-1 min-w-0">
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "0.9rem", color: "var(--color-text)" }}>{page.title}</h3>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-faint)", fontFamily: "var(--font-mono)" }}>{page.path}</p>
          </div>
          <button onClick={onClose} style={{ color: "var(--color-text-faint)" }} className="hover:opacity-70">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 prose">
          {page.rawContent
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.rawContent}</ReactMarkdown>
            : <p style={{ color: "var(--color-text-muted)" }}>No content available</p>}
        </div>
      </div>
    </div>
  );
}

function ChatWelcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-sm text-center px-6">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
          style={{ background: "var(--color-primary-highlight)" }}>
          <Sparkles size={28} style={{ color: "var(--color-primary)" }} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--color-text)", marginBottom: "0.5rem" }}>
          Chat over your wiki
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", marginBottom: "1.5rem" }}>
          Ask questions and get answers grounded in your processed knowledge base. Sources are cited automatically.
        </p>
        <Button onClick={onCreate} className="gap-2">
          <Plus size={14} /> Start a conversation
        </Button>
      </div>
    </div>
  );
}
