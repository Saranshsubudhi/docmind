"use client";

import { FileTextIcon, LoaderIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FC } from "react";
import { ACCEPTED_FILE_TYPES, KNOWLEDGE_BASE_CHANGED, uploadDocument } from "@/lib/document-attachment-adapter";
import { cn } from "@/lib/utils";

type IndexedDocument = { path: string; title: string; chunks: number };

/**
 * Sidebar list of documents in the knowledge base, with upload and delete.
 * Refreshes whenever a file is added from the composer.
 */
export const DocumentsPanel: FC<{ className?: string }> = ({ className }) => {
  const [documents, setDocuments] = useState<IndexedDocument[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/documents");
      const data = (await response.json()) as { documents?: IndexedDocument[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load documents");
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load documents");
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    // Initial fetch, then keep in sync with uploads made from the composer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    window.addEventListener(KNOWLEDGE_BASE_CHANGED, refresh);
    return () => window.removeEventListener(KNOWLEDGE_BASE_CHANGED, refresh);
  }, [refresh]);

  const onUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setError(null);
    for (const file of files) {
      setBusy(`Adding ${file.name}…`);
      try {
        await uploadDocument(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not upload ${file.name}`);
      }
    }
    setBusy(null);
  };

  const onDelete = async (doc: IndexedDocument) => {
    if (!window.confirm(`Remove “${doc.title}” from the knowledge base?`)) return;
    setError(null);
    setBusy(`Removing ${doc.title}…`);
    try {
      const response = await fetch(`/api/documents?path=${encodeURIComponent(doc.path)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not delete");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cn("flex min-h-0 flex-col gap-1 px-2 py-3", className)}>
      <div className="flex items-center justify-between px-1">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Documents</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          aria-label="Upload documents"
          title="Upload documents"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-50"
        >
          <UploadIcon className="size-4" />
        </button>
        <input ref={inputRef} type="file" multiple accept={ACCEPTED_FILE_TYPES} onChange={onUpload} className="hidden" />
      </div>

      {busy && (
        <p className="text-muted-foreground flex items-center gap-1.5 px-1 text-xs">
          <LoaderIcon className="size-3 animate-spin" />
          <span className="truncate">{busy}</span>
        </p>
      )}
      {error && <p className="text-destructive px-1 text-xs">{error}</p>}

      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {documents === null ? (
          <li className="text-muted-foreground px-1 text-xs">Loading…</li>
        ) : documents.length === 0 ? (
          <li className="text-muted-foreground px-1 text-xs leading-relaxed">
            No documents yet. Upload a file here or attach one in the chat.
          </li>
        ) : (
          documents.map((doc) => (
            <li
              key={doc.path}
              className="group hover:bg-muted flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
              title={`${doc.path} · ${doc.chunks} chunks`}
            >
              <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{doc.title}</span>
              <button
                type="button"
                onClick={() => onDelete(doc)}
                disabled={busy !== null}
                aria-label={`Remove ${doc.title}`}
                className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
};
