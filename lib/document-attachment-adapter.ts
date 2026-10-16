import { generateId, type AttachmentAdapter, type PendingAttachment } from "@assistant-ui/react";

/** Fired on window whenever the knowledge base changes, so lists can refresh. */
export const KNOWLEDGE_BASE_CHANGED = "knowledge-base-changed";

export const ACCEPTED_FILE_TYPES =
  "application/pdf,.pdf,text/plain,.txt,text/markdown,.md,.mdx,text/csv,.csv,application/json,.json,text/html,.html,.htm";

type UploadResponse = {
  document: { path: string; title: string; chunks: number };
  text: string;
  truncated: boolean;
  pages?: number;
  error?: string;
};

/** Upload a file to the knowledge base (`/api/documents`). Throws with a user-facing message on failure. */
export async function uploadDocument(file: File): Promise<UploadResponse> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/documents", { method: "POST", body });
  const data = (await response.json().catch(() => null)) as UploadResponse | null;
  if (!response.ok || !data?.document) {
    throw new Error(data?.error ?? `Could not upload ${file.name}`);
  }
  window.dispatchEvent(new Event(KNOWLEDGE_BASE_CHANGED));
  return data;
}

/**
 * Composer attachments. Adding a file uploads it to the knowledge base
 * (chunked, embedded, searchable from every chat) and also inlines its text
 * into this message so the model sees the whole file for the current question.
 */
export class DocumentAttachmentAdapter implements AttachmentAdapter {
  accept = ACCEPTED_FILE_TYPES;

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    const data = await uploadDocument(file);
    const attrs = [`name=${file.name}`, data.pages ? `pages=${data.pages}` : "", data.truncated ? "truncated" : ""]
      .filter(Boolean)
      .join(" ");

    return {
      id: generateId(),
      type: "document",
      name: file.name,
      contentType: file.type || undefined,
      file,
      status: { type: "requires-action", reason: "composer-send" },
      content: [{ type: "text", text: `<attachment ${attrs}>\n${data.text}\n</attachment>` }],
    };
  }

  async send(attachment: PendingAttachment) {
    return { ...attachment, status: { type: "complete" as const }, content: attachment.content ?? [] };
  }

  async remove() {
    // Removing from the composer only detaches it from this message; the file
    // stays in the knowledge base (delete it from the Documents panel).
  }
}
