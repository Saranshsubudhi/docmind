import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { VectorStore, VectorStoreRetriever } from "@langchain/core/vectorstores";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config, requireApiKey } from "@/lib/config";
import type { DocChunk } from "@/lib/chat-protocol";
import { NvidiaEmbeddings } from "./nvidia-embeddings";
import type { ChunkMetadata } from "./splitter";

/**
 * Vector store layer. Everything that knows the concrete store lives in this
 * file: to move to pgvector, Pinecone, Chroma, etc., reimplement
 * `createVectorStore` / `saveVectorStore` / `loadVectorStore` and leave the
 * rest of the app untouched (it only sees LangChain's `VectorStore`).
 */

export const INDEX_FILE = path.join(process.cwd(), "data", "index", "docs-index.json");

const INDEX_VERSION = 1;

type SerializedIndex = {
  version: number;
  embeddingModel: string;
  createdAt: string;
  vectors: { content: string; embedding: number[]; metadata: ChunkMetadata }[];
};

export function getEmbeddings(): EmbeddingsInterface {
  const { provider, model, baseURL } = config.embeddings;
  const apiKey = requireApiKey(config.embeddings.apiKey, "OPENAI_API_KEY (or EMBEDDING_API_KEY)");
  if (provider === "nvidia") {
    return new NvidiaEmbeddings({ apiKey, model, baseURL, maxRetries: 2 });
  }
  return new OpenAIEmbeddings({
    model,
    apiKey,
    maxRetries: 2,
    configuration: baseURL ? { baseURL } : undefined,
  });
}

/** Embed chunks and put them in a fresh store. */
export async function createVectorStore(chunks: Document<ChunkMetadata>[]): Promise<VectorStore> {
  // An empty knowledge base is valid; don't call the embeddings API with nothing.
  if (chunks.length === 0) return new MemoryVectorStore(getEmbeddings());
  return MemoryVectorStore.fromDocuments(chunks, getEmbeddings());
}

/** Persist the store so the server can reload it without re-embedding. */
export async function saveVectorStore(store: VectorStore, file: string = INDEX_FILE): Promise<void> {
  if (!(store instanceof MemoryVectorStore)) {
    // Hosted stores persist on write; nothing to do.
    return;
  }
  const payload: SerializedIndex = {
    version: INDEX_VERSION,
    embeddingModel: config.embeddings.model,
    createdAt: new Date().toISOString(),
    vectors: store.memoryVectors.map((v) => ({
      content: v.content,
      embedding: v.embedding,
      metadata: v.metadata as ChunkMetadata,
    })),
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(payload));
}

/**
 * Load a previously saved index. Returns null when there is no usable index
 * (missing file, old format, or built with a different embedding model).
 */
export async function loadVectorStore(file: string = INDEX_FILE): Promise<VectorStore | null> {
  let payload: SerializedIndex;
  try {
    payload = JSON.parse(await readFile(file, "utf8")) as SerializedIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  if (payload.version !== INDEX_VERSION || payload.embeddingModel !== config.embeddings.model) {
    console.warn(
      `[rag] Ignoring ${path.relative(process.cwd(), file)}: built with ${payload.embeddingModel} ` +
        `(index v${payload.version}), expected ${config.embeddings.model} (v${INDEX_VERSION}). ` +
        "Run `npm run index-docs` to rebuild.",
    );
    return null;
  }

  const store = new MemoryVectorStore(getEmbeddings());
  await store.addVectors(
    payload.vectors.map((v) => v.embedding),
    payload.vectors.map((v) => new Document({ pageContent: v.content, metadata: v.metadata })),
  );
  return store;
}

/** Embed and add chunks to an existing store. */
export async function addToVectorStore(store: VectorStore, chunks: Document<ChunkMetadata>[]): Promise<void> {
  if (chunks.length > 0) await store.addDocuments(chunks);
}

/** Remove every chunk that came from `docPath`. Returns how many were removed. */
export function removeFromVectorStore(store: VectorStore, docPath: string): number {
  if (!(store instanceof MemoryVectorStore)) {
    throw new Error("removeFromVectorStore: implement deletion by metadata for this vector store");
  }
  const before = store.memoryVectors.length;
  store.memoryVectors = store.memoryVectors.filter((v) => (v.metadata as ChunkMetadata).path !== docPath);
  return before - store.memoryVectors.length;
}

export type IndexedDocument = { path: string; title: string; chunks: number; format: ChunkMetadata["format"] };

/** One entry per source file in the store. */
export function listVectorStoreDocuments(store: VectorStore): IndexedDocument[] {
  if (!(store instanceof MemoryVectorStore)) {
    throw new Error("listVectorStoreDocuments: implement listing for this vector store");
  }
  const byPath = new Map<string, IndexedDocument>();
  for (const vector of store.memoryVectors) {
    const meta = vector.metadata as ChunkMetadata;
    const entry = byPath.get(meta.path);
    if (entry) entry.chunks += 1;
    else byPath.set(meta.path, { path: meta.path, title: meta.title, chunks: 1, format: meta.format });
  }
  return [...byPath.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function createRetriever(store: VectorStore, k: number = config.retrieval.topK): VectorStoreRetriever {
  return store.asRetriever({ k });
}

/** Similarity search that keeps scores and drops chunks under the relevance floor. */
export async function searchVectorStore(
  store: VectorStore,
  query: string,
  { k = config.retrieval.topK, minScore = config.retrieval.minScore } = {},
): Promise<DocChunk[]> {
  const results = await store.similaritySearchWithScore(query, k);
  return results
    .filter(([, score]) => score >= minScore)
    .map(([doc, score]) => {
      const meta = doc.metadata as ChunkMetadata;
      return {
        id: `${meta.path}#${meta.chunkIndex}`,
        text: doc.pageContent,
        title: meta.title,
        path: meta.path,
        url: meta.url,
        heading: meta.heading,
        page: meta.page,
        score: Number(score.toFixed(4)),
      };
    });
}
