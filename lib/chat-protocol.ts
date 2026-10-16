/**
 * Wire protocol between `/api/chat` and the browser adapter.
 *
 * Request: JSON `ChatRequest`.
 * Response: newline-delimited JSON, one `ChatStreamEvent` per line.
 *
 * This file is imported by both server and client code, so it must stay free
 * of server-only imports.
 */

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
};

export const SEARCH_DOCS_TOOL = "search_docs";

export type SearchDocsArgs = {
  query: string;
};

/** One retrieved documentation chunk. */
export type DocChunk = {
  id: string;
  text: string;
  title: string;
  /** Repo-relative file path, e.g. `data/docs/installation.md`. */
  path: string;
  url?: string;
  heading?: string;
  page?: number;
  score: number;
};

export type SearchDocsResult = {
  query: string;
  found: boolean;
  chunks: DocChunk[];
};

/** A deduplicated document cited for an answer. */
export type DocSource = {
  id: string;
  title: string;
  path: string;
  url?: string;
  heading?: string;
};

export type ChatStreamEvent =
  | { type: "text-delta"; delta: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: typeof SEARCH_DOCS_TOOL;
      args: SearchDocsArgs;
    }
  | { type: "tool-result"; toolCallId: string; result: SearchDocsResult }
  | { type: "sources"; sources: DocSource[] }
  | { type: "error"; message: string }
  | { type: "done" };
