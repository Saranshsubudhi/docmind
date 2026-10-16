import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { DocMetadata } from "./loader";

/** Metadata on every indexed chunk. */
export type ChunkMetadata = DocMetadata & {
  /** Heading trail of the section the chunk came from, e.g. "Installation > Install the CLI". */
  heading?: string;
  /** Position of the chunk within its source file (0-based). */
  chunkIndex: number;
};

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

/**
 * Split documents into retrieval-sized chunks.
 *
 * Markdown is first cut at headings so each chunk carries the heading it
 * belongs to, then each section goes through RecursiveCharacterTextSplitter.
 */
export async function splitDocs(docs: Document<DocMetadata>[]): Promise<Document<ChunkMetadata>[]> {
  const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  const chunks: Document<ChunkMetadata>[] = [];
  // chunkIndex counts across all pages of a PDF, so key it by file path.
  const nextIndex = new Map<string, number>();

  for (const doc of docs) {
    const sections =
      doc.metadata.format === "markdown"
        ? splitMarkdownSections(doc.pageContent)
        : [{ heading: undefined, text: doc.pageContent }];

    for (const section of sections) {
      for (const text of await splitter.splitText(section.text)) {
        const chunkIndex = nextIndex.get(doc.metadata.path) ?? 0;
        nextIndex.set(doc.metadata.path, chunkIndex + 1);
        chunks.push(
          new Document<ChunkMetadata>({
            pageContent: text,
            metadata: { ...doc.metadata, heading: section.heading, chunkIndex },
          }),
        );
      }
    }
  }

  return chunks;
}

type Section = { heading: string | undefined; text: string };

/** Cut markdown at ATX headings (`#`–`######`), ignoring `#` lines inside code fences. */
function splitMarkdownSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const trail: string[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ heading: trail.filter(Boolean).join(" > ") || undefined, text });
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      trail.length = level - 1;
      trail[level - 1] = match[2];
    }
    // Keep the heading line in the chunk text so the model sees it too.
    buffer.push(line);
  }
  flush();

  return sections;
}
