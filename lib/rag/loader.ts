import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Document } from "@langchain/core/documents";

export const DOCS_DIR = path.join(process.cwd(), "data", "docs");

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json", ".html", ".htm", ".xml"]);
const PDF_EXTENSION = ".pdf";

/** File extensions the knowledge base can index. */
export const SUPPORTED_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS, PDF_EXTENSION];

/** Metadata attached to every loaded document (before splitting). */
export type DocMetadata = {
  title: string;
  /** Repo-relative POSIX path, used as a stable source id. */
  path: string;
  url?: string;
  page?: number;
  format: "markdown" | "text" | "pdf";
};

/**
 * Load every supported file under `dir` (recursively). A missing folder is
 * treated as empty. Markdown and text files produce one document each; PDFs
 * produce one document per page.
 */
export async function loadDocs(dir: string = DOCS_DIR): Promise<Document<DocMetadata>[]> {
  const docs: Document<DocMetadata>[] = [];
  for (const file of await listFiles(dir)) {
    docs.push(...(await loadFile(file)));
  }
  return docs;
}

/** Load one file; returns [] for unsupported extensions. */
export async function loadFile(file: string): Promise<Document<DocMetadata>[]> {
  const ext = path.extname(file).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) return [await loadMarkdown(file)];
  if (TEXT_EXTENSIONS.has(ext)) return [await loadText(file)];
  if (ext === PDF_EXTENSION) return loadPdf(file);
  return [];
}

async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(full);
      return entry.isFile() ? [full] : [];
    }),
  );
  return nested.flat().sort();
}

async function loadText(file: string): Promise<Document<DocMetadata>> {
  const relPath = toRepoPath(file);
  return new Document<DocMetadata>({
    pageContent: (await readFile(file, "utf8")).trim(),
    metadata: { title: path.basename(file), path: relPath, url: urlFromBase(relPath), format: "text" },
  });
}

async function loadMarkdown(file: string): Promise<Document<DocMetadata>> {
  const raw = await readFile(file, "utf8");
  const { data, body } = parseFrontMatter(raw);
  const relPath = toRepoPath(file);

  return new Document<DocMetadata>({
    pageContent: body.trim(),
    metadata: {
      title: data.title ?? firstHeading(body) ?? titleFromFilename(file),
      path: relPath,
      url: data.url ?? urlFromBase(relPath),
      format: "markdown",
    },
  });
}

async function loadPdf(file: string): Promise<Document<DocMetadata>[]> {
  // Loaded lazily so markdown-only projects never pay for the PDF parser.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: await readFile(file) });
  try {
    // Sequential: the first call hands the PDF bytes to the pdf.js worker.
    const text = await parser.getText();
    const info = await parser.getInfo();
    const relPath = toRepoPath(file);
    const pdfTitle = typeof info.info?.Title === "string" ? info.info.Title.trim() : "";
    const title = pdfTitle || titleFromFilename(file);
    const url = urlFromBase(relPath);

    return text.pages
      .filter((page) => page.text.trim().length > 0)
      .map(
        (page) =>
          new Document<DocMetadata>({
            pageContent: page.text.trim(),
            metadata: { title, path: relPath, url, page: page.num, format: "pdf" },
          }),
      );
  } finally {
    await parser.destroy();
  }
}

/** Minimal `key: value` front matter parser — enough for title/url. */
function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && value) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+)$/m.exec(markdown)?.[1].trim();
}

function titleFromFilename(file: string): string {
  const base = path.basename(file, path.extname(file));
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toRepoPath(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

/**
 * Build a public URL from DOCS_BASE_URL for files without an explicit `url`.
 * `data/docs/guides/setup.md` → `${DOCS_BASE_URL}/guides/setup`.
 */
function urlFromBase(relPath: string): string | undefined {
  const base = process.env.DOCS_BASE_URL?.replace(/\/+$/, "");
  if (!base) return undefined;
  const slug = relPath.replace(/^data\/docs\//, "").replace(/\.[a-z0-9]+$/i, "");
  return `${base}/${slug}`;
}
