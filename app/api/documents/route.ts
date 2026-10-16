import { addDocument, isSupportedFile, listDocuments, removeDocument, UserFacingError } from "@/lib/rag";

export const maxDuration = 120;

/** Largest file accepted, in bytes. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Text returned for inlining into the chat message (~15k tokens). */
const MAX_INLINE_CHARS = 60_000;

export type UploadDocumentResponse = {
  document: { path: string; title: string; chunks: number };
  /** Extracted text for the current message (may be truncated). */
  text: string;
  truncated: boolean;
  pages?: number;
};

/** List documents in the knowledge base. */
export async function GET() {
  try {
    return Response.json({ documents: await listDocuments() });
  } catch (error) {
    return errorResponse(error, "Could not load the knowledge base.");
  }
}

/** Upload a file: save it, index it, and return its text for the current message. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Send the file as multipart form field `file`." }, { status: 400 });
  }
  if (!isSupportedFile(file.name)) {
    return Response.json(
      { error: "Unsupported file type. Upload a PDF, Markdown, or text file (.txt, .csv, .json, .html)." },
      { status: 415 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "File is larger than 10 MB." }, { status: 413 });
  }

  try {
    const { document, text, pages } = await addDocument(file.name, new Uint8Array(await file.arrayBuffer()));
    const truncated = text.length > MAX_INLINE_CHARS;
    return Response.json({
      document,
      text: truncated ? `${text.slice(0, MAX_INLINE_CHARS)}\n\n[…truncated; the full file is searchable]` : text,
      truncated,
      pages,
    } satisfies UploadDocumentResponse);
  } catch (error) {
    return errorResponse(error, "Could not add this file to the knowledge base.");
  }
}

/** Delete a document: DELETE /api/documents?path=data/docs/uploads/file.pdf */
export async function DELETE(req: Request) {
  const docPath = new URL(req.url).searchParams.get("path");
  if (!docPath) {
    return Response.json({ error: "Missing `path`." }, { status: 400 });
  }
  try {
    const removed = await removeDocument(docPath);
    return Response.json({ removed });
  } catch (error) {
    return errorResponse(error, "Could not delete this document.");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof UserFacingError) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  console.error("[api/documents]", error);
  const message = error instanceof Error ? error.message : "";
  if (message.includes("is not set. Copy .env.example")) {
    return Response.json({ error: message }, { status: 500 });
  }
  return Response.json({ error: fallback }, { status: 500 });
}
