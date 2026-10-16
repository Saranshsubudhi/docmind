import { z } from "zod";
import { runDocsAgent } from "@/lib/agent/docs-agent";
import type { ChatStreamEvent } from "@/lib/chat-protocol";

export const maxDuration = 60;

const MAX_MESSAGES = 50;
// Room for an attached PDF (extraction caps each file at 60k chars).
const MAX_MESSAGE_CHARS = 150_000;

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(MAX_MESSAGE_CHARS),
      }),
    )
    .min(1)
    .refine((messages) => messages.at(-1)?.role === "user", "The last message must be from the user."),
});

export async function POST(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  // Keep the most recent turns; older context rarely helps doc lookups.
  const messages = parsed.data.messages.slice(-MAX_MESSAGES);

  // Aborts when the client disconnects (req.signal) or cancels the stream.
  const abort = new AbortController();
  const onClientAbort = () => abort.abort(req.signal.reason);
  req.signal.addEventListener("abort", onClientAbort, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runDocsAgent({ messages, signal: abort.signal })) {
          if (abort.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[api/chat]", error);
          send({ type: "error", message: publicErrorMessage(error) });
        }
      } finally {
        req.signal.removeEventListener("abort", onClientAbort);
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled reader.
        }
      }
    },
    cancel(reason) {
      abort.abort(reason);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function publicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("is not set. Copy .env.example")) return message;
  if (/401|invalid api key|incorrect api key|unauthorized/i.test(message)) {
    return "The language model rejected the API key. Check OPENAI_API_KEY (or NVIDIA_API_KEY).";
  }
  if (/timed? ?out|timeout/i.test(message)) {
    return "The model provider took too long to respond. Please try again.";
  }
  if (/429|rate limit/i.test(message)) {
    return "The model provider's rate limit was reached. Wait a moment and try again.";
  }
  return "Something went wrong while generating the answer. Please try again.";
}
