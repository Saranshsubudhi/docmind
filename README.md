# DocMind: Agentic RAG Assistant

**DocMind** is a ChatGPT-style assistant that answers questions from **your own documents**. Upload PDFs or notes; DocMind decides when to search them, retrieves the relevant passages, and answers with cited sources. When the answer isn't in your documents, it says so.

**Stack:** Next.js (App Router) · TypeScript · assistant-ui · LangChain.js · NVIDIA Nemotron (free API) · vector search (RAG)

- Upload PDFs or text files, and they're chunked, embedded and added to a searchable knowledge base (RAG).
- Questions about your documents call a `search_docs` tool, and the answer is grounded in the retrieved excerpts, with the source documents shown under it.
- Greetings and general questions are answered directly, with no retrieval.
- If the documents don't contain the answer, the assistant says "I couldn't find this in your documents." It does not guess.
- Answers stream token by token. A search card shows while retrieval runs, and you can stop any answer.

## Quick start

```bash
npm install
cp .env.example .env.local     # then paste your nvapi- key into OPENAI_API_KEY
npm run dev                    # http://localhost:3000
```

Then upload a document (see below) and ask about it.

### Models: NVIDIA Nemotron (free)

By default, chat and embeddings use NVIDIA's free prototyping endpoint at build.nvidia.com, so one free key covers everything:

| | Model |
| --- | --- |
| Chat | `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| Chat fallback | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Embeddings | `nvidia/nemotron-3-embed-1b` |

**Automatic fallback:** free endpoints are sometimes overloaded and stop responding. If the chat model errors, or sends nothing within `CHAT_FIRST_TOKEN_TIMEOUT_MS` (default 20 s), the same question is retried on `CHAT_FALLBACK_MODEL`, and the switch is logged on the server. It only happens before any text has streamed, so you never see a half answer from one model followed by another. Leave `CHAT_FALLBACK_MODEL` empty to disable it.

1. Sign in at https://build.nvidia.com and create an API key (it starts with `nvapi-`).
2. Put it in `.env.local` as `OPENAI_API_KEY` (or `NVIDIA_API_KEY`).

The free tier is rate-limited (about 40 requests per minute), is meant for prototyping, and **logs requests**. Don't upload confidential documents to it.

- **Nemotron details:** Nemotron 3.x reasons ("thinks") before answering by default. The agent sends `chat_template_kwargs: { enable_thinking: false }` to Nemotron models and strips any `<think>…</think>` or raw `<tool_call>` text that still comes through. Set `CHAT_ENABLE_THINKING=true` to turn reasoning back on.
- **Timeouts:** once a model is streaming, it fails if it goes silent for `CHAT_TIMEOUT_MS` (default 60 s), so a stalled endpoint shows an error instead of spinning forever.
- **NVIDIA embeddings** need an `input_type` field (`passage` for documents, `query` for searches), which `lib/rag/nvidia-embeddings.ts` sends.
- **Other providers:** any OpenAI-compatible API works. Set `OPENAI_BASE_URL` and `CHAT_MODEL`, plus `EMBEDDING_*` if embeddings come from a different provider. Changing the embedding model invalidates the index, so re-run `npm run index-docs`. Keys are read only on the server.

## Adding documents

**From the app** (easiest):
- **Documents panel** (bottom of the sidebar): click the upload icon. Uploaded files are listed there; hover a file and click the trash icon to remove it.
- **Paperclip / drag-and-drop in the chat:** the file is added to the knowledge base, *and* its full text is sent with that message, so "summarize this" or "how is my experience?" sees the whole document. Later questions, in any chat, find it through search.

Supported formats: PDF (with a text layer, not scanned images), `.md`, `.mdx`, `.txt`, `.csv`, `.json`, `.html`. Max 10 MB per file. Uploading a file with the same name replaces the old version.

Uploads are saved to `data/docs/uploads/` (gitignored), and the index is saved to `data/index/docs-index.json` (also gitignored), so both survive restarts.

**From disk:** put files anywhere under `data/docs/` and run:

```bash
npm run index-docs
```

That re-indexes everything in `data/docs/`, including uploads. Markdown files can have optional front matter, used for the source title and link:

```markdown
---
title: Installation
url: https://docs.example.com/getting-started/installation
---
```

## Example questions

After uploading, for example, a resume and a pricing PDF:

| Ask | Expected |
| --- | --- |
| `Hi` | Direct reply, no search card |
| `What machine learning projects have I done?` | Search card, then an answer citing the resume |
| `How much does the Pro plan cost?` | Search card, then an answer citing the pricing PDF |
| `What is my GPA?` (not in the documents) | "I couldn't find this in your documents." |
| `What is the capital of France?` | Answered from general knowledge, no search |
| Attach a file and ask `How is my ML experience?` | A full assessment of the attached file |
| Any long answer, then press ■ | Streaming stops and the server aborts the LLM request |

## How it works

```
assistant-ui Thread (components/thread.tsx)
  └─ useLocalRuntime(docsChatAdapter)              app/page.tsx
       └─ POST /api/chat  ── NDJSON stream ──┐     lib/docs-chat-adapter.ts
                                             │
app/api/chat/route.ts  → runDocsAgent()      │     lib/agent/docs-agent.ts
   model + search_docs tool (tool_choice: auto)
   ├─ answers directly, or
   └─ search_docs(query) → searchDocs()            lib/rag/index.ts
          └─ MemoryVectorStore similarity search    lib/rag/retriever.ts

Uploads: composer / Documents panel → POST /api/documents
   → save to data/docs/uploads → load → split → embed → add to store → save index
```

**Ingestion:** files are loaded with metadata (title, path, PDF page). Markdown is cut at headings and every section is split with `RecursiveCharacterTextSplitter` (1000 chars, 150 overlap). Chunks are embedded and stored. Index writes are serialized, so concurrent uploads can't overwrite each other's save.

**Agent:** the system prompt lists the documents in the knowledge base, so the model knows when a question is worth searching. Each message gets at most 3 model turns: it can search, search once more with a different query, and the last turn is forced to answer without tools. Turns whose message has an attachment use a file-first prompt.

**Stream events** (`lib/chat-protocol.ts`): `text-delta`, `tool-call`, `tool-result`, `sources`, `error`, `done`. The adapter turns them into assistant-ui message parts: a `tool-call` part (search card), `text` parts, and `source` parts (the Sources list).

**"Not found":** chunks with cosine similarity below `RETRIEVAL_MIN_SCORE` (default 0.3) are dropped. If none are left, the tool tells the model nothing relevant was found. Tune this value for your embedding model.

**Cancel:** the runtime's abort signal cancels the `fetch`. That fires `req.signal` on the server, which aborts the LangChain stream and the upstream LLM request.

## Swapping the vector store

Everything that knows about `MemoryVectorStore` is in `lib/rag/retriever.ts`: create, add, remove-by-document, list, save and load. To move to pgvector, Pinecone, Chroma or similar, reimplement those functions there. The rest of the app only sees LangChain's `VectorStore` interface.

## Project layout

```
app/api/chat/route.ts             streaming chat endpoint (validation, NDJSON, abort)
app/api/documents/route.ts        knowledge base: list (GET), upload (POST), delete (DELETE)
lib/agent/docs-agent.ts           prompts, search_docs tool, tool-calling loop
lib/agent/hidden-block-filter.ts  strips <think>/<tool_call> text from the stream
lib/rag/index.ts                  buildIndex, add/remove/list documents, searchDocs
lib/rag/loader.ts                 PDF/markdown/text loading and metadata
lib/rag/splitter.ts               heading-aware chunking
lib/rag/retriever.ts              embeddings, vector store, persistence, scored search
lib/rag/nvidia-embeddings.ts      NVIDIA retrieval embeddings (input_type query/passage)
lib/config.ts                     env-based server config
lib/chat-protocol.ts              shared request/stream types
lib/docs-chat-adapter.ts          ChatModelAdapter for useLocalRuntime
lib/document-attachment-adapter.ts composer attachments → knowledge base
components/rag/documents-panel.tsx sidebar Documents list (upload/delete)
components/rag/tool-call.tsx      "Searching your documents…" card and results
components/rag/sources.tsx        Sources list under answers
scripts/index-docs.ts             npm run index-docs
data/docs/                        documents (uploads in data/docs/uploads/)
```
