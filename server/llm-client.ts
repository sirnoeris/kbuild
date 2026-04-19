/**
 * Generic LLM client that routes through any OpenAI-compatible endpoint.
 */
import { storage } from "./storage.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export async function callLLM(
  connectionId: number,
  model: string,
  messages: LLMMessage[],
  options?: { temperature?: number; max_tokens?: number }
): Promise<LLMResponse> {
  const conn = storage.getConnection(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  const baseUrl = conn.baseUrl.replace(/\/$/, "");
  const chatUrl = `${baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options?.temperature ?? 0.3,
    max_tokens: options?.max_tokens ?? 4096,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (conn.apiKey) {
    headers["Authorization"] = `Bearer ${conn.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as any;
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      model: data.model,
      usage: data.usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listModels(connectionId: number): Promise<string[]> {
  const conn = storage.getConnection(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);

  const baseUrl = conn.baseUrl.replace(/\/$/, "");
  const modelsUrl = conn.modelsEndpoint ?? `${baseUrl}/models`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn.apiKey) headers["Authorization"] = `Bearer ${conn.apiKey}`;

  const res = await fetch(modelsUrl, { headers });
  if (!res.ok) throw new Error(`Models API error ${res.status}`);
  const data = await res.json() as any;

  if (Array.isArray(data)) return data.map((m: any) => m.id ?? m.name ?? String(m));
  if (data.data && Array.isArray(data.data)) return data.data.map((m: any) => m.id ?? m.name ?? String(m));
  return [];
}
