import type {
  ChatModelAdapter,
  SourceMessagePart,
  TextMessagePart,
  ThreadMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import type { ChatMessage, ChatStreamEvent, DocSource, SearchDocsArgs, SearchDocsResult } from "@/lib/chat-protocol";

type ContentPart = TextMessagePart | ToolCallMessagePart<SearchDocsArgs, SearchDocsResult>;

/** Flatten assistant-ui messages to the plain-text history the API expects. */
function toChatMessages(messages: readonly ThreadMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;

    const parts = [...message.content, ...(message.role === "user" ? message.attachments.flatMap((a) => a.content ?? []) : [])];
    const content = parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (content) result.push({ role: message.role, content });
  }
  return result;
}

function toSourcePart(source: DocSource): SourceMessagePart {
  return source.url
    ? { type: "source", sourceType: "url", id: source.id, url: source.url, title: source.title }
    : { type: "source", sourceType: "document", id: source.id, title: source.title, mediaType: "text/markdown", filename: source.path };
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as ChatStreamEvent;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as ChatStreamEvent;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Connects useLocalRuntime to `/api/chat`. Streams text deltas, a
 * `search_docs` tool-call part (rendered by SearchDocsToolUI) and source parts
 * (rendered by MessageSources). The runtime's abort signal cancels the fetch,
 * which in turn aborts the server-side LLM call.
 */
export const docsChatAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: toChatMessages(messages) }),
      signal: abortSignal,
    });

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Chat request failed (${response.status})`);
    }

    let parts: ContentPart[] = [];
    let sources: SourceMessagePart[] = [];

    for await (const event of readEvents(response.body)) {
      switch (event.type) {
        case "text-delta": {
          const last = parts.at(-1);
          parts =
            last?.type === "text"
              ? [...parts.slice(0, -1), { type: "text", text: last.text + event.delta }]
              : [...parts, { type: "text", text: event.delta }];
          break;
        }
        case "tool-call":
          parts = [
            ...parts,
            {
              type: "tool-call",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              argsText: JSON.stringify(event.args),
            },
          ];
          break;
        case "tool-result":
          parts = parts.map((part) =>
            part.type === "tool-call" && part.toolCallId === event.toolCallId ? { ...part, result: event.result } : part,
          );
          break;
        case "sources":
          // Each event carries the full, deduplicated list so far.
          sources = event.sources.map(toSourcePart);
          break;
        case "error":
          throw new Error(event.message);
        case "done":
          break;
      }

      yield { content: [...parts, ...sources] };
    }
  },
};
