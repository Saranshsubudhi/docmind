/**
 * Server-side configuration read from environment variables.
 * Never import this module from client components — it reads API keys.
 */

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function number(name: string, fallback: number): number {
  const raw = optional(name);
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(name: string): boolean | undefined {
  const raw = optional(name)?.toLowerCase();
  if (raw === undefined) return undefined;
  return raw === "true" || raw === "1" || raw === "yes";
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

const chatModel = optional("CHAT_MODEL") ?? "nvidia/nemotron-3.5-super-vl-120b-a12b";
const chatBaseURL = optional("OPENAI_BASE_URL") ?? (chatModel.startsWith("nvidia/") ? NVIDIA_BASE_URL : undefined);
const embeddingBaseURL = optional("EMBEDDING_BASE_URL") ?? chatBaseURL;
const embeddingProvider =
  optional("EMBEDDING_PROVIDER") === "openai" || optional("EMBEDDING_PROVIDER") === "nvidia"
    ? (optional("EMBEDDING_PROVIDER") as "openai" | "nvidia")
    : embeddingBaseURL?.includes("api.nvidia.com")
      ? "nvidia"
      : "openai";

export const config = {
  llm: {
    // NVIDIA's examples call it NVIDIA_API_KEY; accept either name.
    apiKey: optional("OPENAI_API_KEY") ?? optional("NVIDIA_API_KEY"),
    baseURL: chatBaseURL,
    model: chatModel,
    // Used when the main model errors or stays silent before its first token.
    fallbackModel:
      optional("CHAT_FALLBACK_MODEL") ??
      (chatModel.startsWith("nvidia/") ? "nvidia/nemotron-3.5-lightning-30b-a3b" : undefined),
    // Reasoning models (Nemotron 3.x) think by default; that only adds latency
    // here and can leak <think> text, so it's off unless explicitly enabled.
    enableThinking: flag("CHAT_ENABLE_THINKING") ?? false,
    // Explicit cap so endpoints with a small default don't truncate answers.
    maxTokens: number("CHAT_MAX_TOKENS", 4096),
    // Per-request timeout and retries, so a stalled provider fails fast
    // instead of leaving the user on an endless spinner.
    timeoutMs: number("CHAT_TIMEOUT_MS", 60_000),
    // How long to wait for the first token before switching to the fallback model.
    firstTokenTimeoutMs: number("CHAT_FIRST_TOKEN_TIMEOUT_MS", 20_000),
    maxRetries: number("CHAT_MAX_RETRIES", 2),
  },

  embeddings: {
    provider: embeddingProvider,
    // Fall back to the chat provider when no separate embeddings provider is set.
    apiKey: optional("EMBEDDING_API_KEY") ?? optional("OPENAI_API_KEY") ?? optional("NVIDIA_API_KEY"),
    baseURL: embeddingBaseURL,
    model:
      optional("EMBEDDING_MODEL") ??
      (embeddingProvider === "nvidia" ? "nvidia/nemotron-3-embed-1b" : "text-embedding-3-small"),
  },

  retrieval: {
    topK: Math.min(Math.max(number("RETRIEVAL_TOP_K", 5), 1), 10),
    // Cosine similarity floor; chunks below it are treated as "not relevant".
    minScore: number("RETRIEVAL_MIN_SCORE", 0.3),
  },
} as const;

export function requireApiKey(key: string | undefined, name: string): string {
  if (!key) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and add your key.`);
  }
  return key;
}
