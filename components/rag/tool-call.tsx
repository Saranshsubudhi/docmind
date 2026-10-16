"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { ChevronDownIcon, FileTextIcon, LoaderIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SEARCH_DOCS_TOOL, type SearchDocsArgs, type SearchDocsResult } from "@/lib/chat-protocol";
import { cn } from "@/lib/utils";

const cardClass = "my-2 w-full rounded-xl border border-border/60 bg-muted/30 px-3 text-sm";

/**
 * Renders `search_docs` tool calls: a "Searching your documents…" card while
 * retrieval runs, then a collapsible list of the matched excerpts.
 * Registered as standalone so it isn't folded into the generic tool group.
 */
export const SearchDocsToolUI = makeAssistantToolUI<SearchDocsArgs, SearchDocsResult>({
  toolName: SEARCH_DOCS_TOOL,
  display: "standalone",
  render: ({ args, result, status }) => {
    const query = args?.query;

    if (status.type === "incomplete" || (status.type !== "running" && !result)) {
      return (
        <div className={cn(cardClass, "text-muted-foreground flex items-center gap-2 py-2")}>
          <SearchXIcon className="size-4 shrink-0" />
          <span className="line-through">Document search{query ? ` for “${query}”` : ""}</span>
        </div>
      );
    }

    if (!result) {
      return (
        <div
          role="status"
          className={cn(cardClass, "text-muted-foreground flex items-center gap-2 py-2")}
        >
          <LoaderIcon className="size-4 shrink-0 animate-spin [animation-duration:0.6s]" />
          <span className="relative">
            Searching your documents…
            <span aria-hidden className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none">
              Searching your documents…
            </span>
          </span>
          {query && <span className="truncate text-xs">“{query}”</span>}
        </div>
      );
    }

    if (!result.found) {
      return (
        <div className={cn(cardClass, "text-muted-foreground flex items-center gap-2 py-2")}>
          <SearchXIcon className="size-4 shrink-0" />
          <span>Nothing found in your documents for “{result.query}”</span>
        </div>
      );
    }

    return (
      <Collapsible className={cardClass}>
        <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground flex w-full items-center gap-2 py-2 text-start transition-colors">
          <SearchIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Searched your documents for <span className="text-foreground font-medium">“{result.query}”</span>
            {" · "}
            {result.chunks.length} {result.chunks.length === 1 ? "result" : "results"}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 -rotate-90 transition-transform group-data-panel-open/trigger:rotate-0" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex flex-col gap-2 pb-3">
            {result.chunks.map((chunk) => (
              <li key={chunk.id} className="bg-background rounded-lg border border-border/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="truncate">
                    {chunk.title}
                    {chunk.heading && chunk.heading !== chunk.title && (
                      <span className="text-muted-foreground font-normal"> — {chunk.heading}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground ms-auto shrink-0 font-normal tabular-nums">
                    {chunk.score.toFixed(2)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-3 text-xs whitespace-pre-line">{chunk.text}</p>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    );
  },
});
