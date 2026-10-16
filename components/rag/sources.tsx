"use client";

import { type SourceMessagePart, useAuiState } from "@assistant-ui/react";
import { BookOpenIcon, ChevronDownIcon, ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { useMemo, type FC } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * Collapsible "Sources" list for the current assistant message, built from
 * its `source` parts. Renders nothing when the answer used no retrieval.
 */
export const MessageSources: FC = () => {
  const content = useAuiState((s) => s.message.content);
  const sources = useMemo(
    () => content.filter((part): part is SourceMessagePart => part.type === "source"),
    [content],
  );

  if (sources.length === 0) return null;

  return (
    <Collapsible defaultOpen className="mt-3 w-full">
      <CollapsibleTrigger className="group/trigger text-muted-foreground hover:text-foreground flex items-center gap-1.5 py-1 text-xs font-medium transition-colors">
        <BookOpenIcon className="size-3.5" />
        Sources ({sources.length})
        <ChevronDownIcon className="size-3.5 -rotate-90 transition-transform group-data-panel-open/trigger:rotate-0" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-wrap gap-2 pt-1.5">
          {sources.map((source) => (
            <li key={source.id}>
              {source.sourceType === "url" ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-border/60 hover:bg-muted inline-flex max-w-72 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors"
                >
                  <span className="truncate">{source.title ?? source.url}</span>
                  <ExternalLinkIcon className="text-muted-foreground size-3 shrink-0" />
                </a>
              ) : (
                <span
                  title={source.filename}
                  className="border-border/60 inline-flex max-w-72 items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
                >
                  <FileTextIcon className="text-muted-foreground size-3 shrink-0" />
                  <span className="truncate">{source.title}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
};
