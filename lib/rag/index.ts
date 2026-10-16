import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VectorStore, VectorStoreRetriever } from "@langchain/core/vectorstores";
import type { SearchDocsResult } from "@/lib/chat-protocol";
import { config } from "@/lib/config";
import { DOCS_DIR, loadDocs, loadFile, SUPPORTED_EXTENSIONS } from "./loader";
import {
  addToVectorStore,
  createRetriever,
  createVectorStore,
  type IndexedDocument,
  listVectorStoreDocuments,
  loadVectorStore,
  removeFromVectorStore,
  saveVectorStore,
  searchVectorStore,
} from "./retriever";
import { splitDocs } from "./splitter";

export type { IndexedDocument };
export type IndexStats = { files: number; documents: number; chunks: number };

/** Where files uploaded from the chat UI are stored (inside DOCS_DIR, so `npm run index-docs` picks them up). */
export const UPLOADS_DIR = path.join(DOCS_DIR, "uploads");

/** Load → split → embed → store. Used by `npm run index-docs`. */
export async function buildIndex({ save = true } = {}): Promise<{ store: VectorStore; stats: IndexStats }> {
  const docs = await loadDocs(DOCS_DIR);
  const chunks = await splitDocs(docs);
  const store = await createVectorStore(chunks);
  if (save) await saveVectorStore(store);

  return {
    store,
    stats: {
      files: new Set(docs.map((d) => d.metadata.path)).size,
      documents: docs.length,
      chunks: chunks.length,
    },
  };
}

// Cache on globalThis so Next.js dev hot reloads don't reload/re-embed the index.
const globalForRag = globalThis as unknown as {
  docsStore?: Promise<VectorStore>;
  writeQueue?: Promise<unknown>;
};

/**
 * The shared vector store for the server. Loads the saved index; if there is
 * none, builds one from DOCS_DIR (an empty folder gives an empty store).
 */
export function getVectorStore(): Promise<VectorStore> {
  globalForRag.docsStore ??= (async () => {
    const saved = await loadVectorStore();
    if (saved) return saved;
    console.warn("[rag] No saved index found; building one from data/docs.");
    const { store, stats } = await buildIndex({ save: true });
    console.info(`[rag] Indexed ${stats.chunks} chunks from ${stats.files} files.`);
    return store;
  })().catch((error) => {
    // Don't cache failures; the next request retries.
    globalForRag.docsStore = undefined;
    throw error;
  });
  return globalForRag.docsStore;
}

/** Run index mutations one at a time so concurrent uploads can't clobber the saved index. */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = (globalForRag.writeQueue ?? Promise.resolve()).then(task, task);
  globalForRag.writeQueue = run.catch(() => undefined);
  return run;
}

/** Turn an uploaded file name into a safe, flat file name inside UPLOADS_DIR. */
export function safeUploadName(name: string): string {
  const base = path.basename(name).normalize("NFKC");
  const ext = path.extname(base).toLowerCase();
  const stem = path
    .basename(base, path.extname(base))
    .replace(/[^\w.\- ]+/g, "_")
    .trim()
    .slice(0, 100);
  return `${stem || "document"}${ext}`;
}

export function isSupportedFile(name: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/**
 * Save an uploaded file to data/docs/uploads, index it, and persist the index.
 * Re-uploading a file with the same name replaces the previous version.
 */
export function addDocument(name: string, data: Uint8Array): Promise<{ document: IndexedDocument; text: string; pages?: number }> {
  return serialize(async () => {
    const fileName = safeUploadName(name);
    const filePath = path.join(UPLOADS_DIR, fileName);
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(filePath, data);

    try {
      const docs = await loadFile(filePath);
      const text = docs
        .map((d) => (d.metadata.page !== undefined ? `[Page ${d.metadata.page}]\n${d.pageContent}` : d.pageContent))
        .join("\n\n")
        .trim();
      if (!text) {
        throw new UserFacingError(
          path.extname(fileName).toLowerCase() === ".pdf"
            ? "No text found in this PDF. It may be a scanned image."
            : "This file is empty.",
        );
      }

      const chunks = await splitDocs(docs);
      const store = await getVectorStore();
      const docPath = docs[0].metadata.path;
      removeFromVectorStore(store, docPath);
      await addToVectorStore(store, chunks);
      await saveVectorStore(store);

      const pages = docs.some((d) => d.metadata.page !== undefined) ? docs.length : undefined;
      return {
        document: { path: docPath, title: docs[0].metadata.title, chunks: chunks.length, format: docs[0].metadata.format },
        text,
        pages,
      };
    } catch (error) {
      // Keep files and index in sync: a failed (re-)upload leaves neither behind.
      await rm(filePath, { force: true });
      const store = await getVectorStore().catch(() => null);
      if (store && removeFromVectorStore(store, `data/docs/uploads/${fileName}`) > 0) {
        await saveVectorStore(store);
      }
      throw error;
    }
  });
}

/** Remove a document (by repo-relative path) from the index and delete its file. */
export function removeDocument(docPath: string): Promise<boolean> {
  return serialize(async () => {
    // Resolve inside DOCS_DIR only (also keeps the build from tracing the whole project).
    const DOCS_PREFIX = "data/docs/";
    const absolute = docPath.startsWith(DOCS_PREFIX) ? path.resolve(DOCS_DIR, docPath.slice(DOCS_PREFIX.length)) : "";
    if (!absolute.startsWith(DOCS_DIR + path.sep)) {
      throw new UserFacingError("Only files in the knowledge base can be deleted.");
    }
    const store = await getVectorStore();
    const removed = removeFromVectorStore(store, docPath);
    await saveVectorStore(store);
    await rm(absolute, { force: true });
    return removed > 0;
  });
}

export async function listDocuments(): Promise<IndexedDocument[]> {
  return listVectorStoreDocuments(await getVectorStore());
}

/** The docs index as a standard LangChain retriever (for chains or other consumers). */
export async function getDocsRetriever(k: number = config.retrieval.topK): Promise<VectorStoreRetriever> {
  return createRetriever(await getVectorStore(), k);
}

/** Backing implementation of the `search_docs` tool. */
export async function searchDocs(query: string): Promise<SearchDocsResult> {
  const chunks = await searchVectorStore(await getVectorStore(), query);
  return { query, found: chunks.length > 0, chunks };
}

/** An error whose message is safe to show to the user. */
export class UserFacingError extends Error {}
