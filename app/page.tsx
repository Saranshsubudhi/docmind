"use client";

import { useState } from "react";
import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { DocumentsPanel } from "@/components/rag/documents-panel";
import { SearchDocsToolUI } from "@/components/rag/tool-call";
import { Thread } from "@/components/thread";
import { DocumentAttachmentAdapter } from "@/lib/document-attachment-adapter";
import { docsChatAdapter } from "@/lib/docs-chat-adapter";

// Files attached in the composer are added to the knowledge base and inlined
// into the message they were attached to.
const attachmentAdapter = new DocumentAttachmentAdapter();

const mockConversations = [
  "Eligibility question",
  "Order status",
  "General inquiry",
  "Billing issue",
];

export default function Home() {
  const runtime = useLocalRuntime(docsChatAdapter, {
    adapters: { attachments: attachmentAdapter },
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SearchDocsToolUI />
      <div className="flex h-screen bg-muted/30">
        {sidebarOpen && (
          <aside className="flex h-full w-[260px] shrink-0 flex-col border-r bg-muted/40">
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="size-4" />
                New Chat
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse sidebar"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
              {mockConversations.map((title) => (
                <div
                  key={title}
                  className="cursor-pointer truncate rounded-lg px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted"
                >
                  {title}
                </div>
              ))}
            </nav>
            <DocumentsPanel className="max-h-[45%] border-t" />
          </aside>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b bg-background/80 px-6 py-3.5 backdrop-blur-sm">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Expand sidebar"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PanelLeftOpen className="size-4" />
              </button>
            )}
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              D
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">DocMind</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Answers from your documents</p>
            </div>
          </header>
          <div className="flex-1 overflow-hidden">
            <Thread />
          </div>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
