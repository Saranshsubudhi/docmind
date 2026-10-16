/**
 * Build the documentation index: `npm run index-docs`
 *
 * Loads data/docs, splits, embeds, and saves vectors to data/index so the
 * chat server can load them without re-embedding.
 */
import "./load-env";
import path from "node:path";
import { config } from "@/lib/config";
import { buildIndex } from "@/lib/rag";
import { INDEX_FILE } from "@/lib/rag/retriever";

async function main() {
  const started = Date.now();
  console.log(`Indexing docs with ${config.embeddings.model}…`);

  const { stats } = await buildIndex({ save: true });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Indexed ${stats.chunks} chunks from ${stats.files} files in ${seconds}s → ${path.relative(process.cwd(), INDEX_FILE)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
