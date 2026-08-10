"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { Thread } from "@/components/thread";

const mockAdapter: ChatModelAdapter = {
  async run() {
    return { content: [] };
  },
};

export default function Home() {
  const runtime = useLocalRuntime(mockAdapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-screen flex-col bg-muted/30">
        <header className="flex items-center gap-3 border-b bg-background/80 px-6 py-3.5 backdrop-blur-sm">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            A
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Assistant</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Online</p>
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}