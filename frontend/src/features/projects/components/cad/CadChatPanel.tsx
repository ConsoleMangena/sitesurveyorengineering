import { useState } from "react";
import { Bot, X } from "lucide-react";

import { Button } from "@/components/ui/button.tsx";
import AssistantPage from "../../../../pages/shared/AssistantPage.tsx";
import { CadCommandBridge } from "./CadCommandBridge.tsx";
import type { UseCadModel } from "./useCadModel.ts";

interface CadChatPanelProps {
  projectId: string;
  cad: UseCadModel;
  onClose: () => void;
}

/**
 * Chat side panel for the CAD workspace: embeds the assistant beside the
 * canvas and surfaces `[CAD]` command blocks from the latest reply as
 * executable cards above the input area's footer line.
 */
export function CadChatPanel({ projectId, cad, onClose }: CadChatPanelProps) {
  const [lastReply, setLastReply] = useState("");
  const hasReply = lastReply.trim().length > 0;

  return (
    <div className="flex h-full flex-col border-l border-border/60 bg-background" aria-label="SiteSurveyor AI panel">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold">SiteSurveyor AI</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onClose}
          aria-label="Close assistant panel"
        >
          <X className="size-4" />
        </Button>
      </header>

      {/* AssistantPage fills height via its own h-full root, so the embedded
          chat scrolls internally instead of stretching the panel. */}
      <div className="min-h-0 flex-1 overflow-hidden [&>*]:h-full">
        <AssistantPage embedded contextProjectId={projectId} onAssistantFinal={setLastReply} />
      </div>

      {hasReply && (
        <footer className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border/60 p-3">
          <CadCommandBridge messageText={lastReply} cad={cad} />
        </footer>
      )}
    </div>
  );
}
