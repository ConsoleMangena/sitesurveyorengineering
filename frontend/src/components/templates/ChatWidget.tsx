import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import {
  MessageSquare,
  Send,
  Trash2,
  MessageCircle,
  ChevronDown,
  Loader2,
  WifiOff,
  Users
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Avatar, AvatarFallback } from "../ui/avatar.tsx";
import { Badge } from "../ui/badge.tsx";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle,
  SheetDescription
} from "../ui/sheet.tsx";
import { 
  listChatMessages, 
  sendChatMessage, 
  deleteChatMessage, 
  subscribeWorkspaceChat,
  type ChatMessage
} from "../../lib/repositories/chat.ts";
import {
  listWorkspaceMembers,
  type WorkspaceMemberWithProfile,
} from "../../lib/repositories/workspaceMembers.ts";
import { notifyChatMessage } from "../../lib/repositories/notificationEvents.ts";
import { markChatNotificationsRead } from "../../lib/repositories/notifications.ts";
import { getCurrentUser } from "../../lib/auth/session.ts";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatWidgetProps {
  workspaceId: string;
  workspaceName?: string;
  canModerate?: boolean;
}

const NEAR_BOTTOM_PX = 80;
const MAX_MESSAGE_LENGTH = 2000;
/** Messages from the same sender within this window render as one group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Deterministic avatar tint per sender so people are easy to tell apart. */
const AVATAR_COLORS = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
];

function avatarColor(userId: string | null): string {
  if (!userId) return "bg-muted text-muted-foreground";
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Human-friendly labels for workspace roles (same roles as the Team page). */
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  ops_manager: "Ops Manager",
  finance: "Finance",
  sales: "Sales",
  technician: "Technician",
  viewer: "Viewer",
};

function roleLabel(role: string | null | undefined): string {
  if (!role) return "Member";
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function memberDisplayName(member: WorkspaceMemberWithProfile): string {
  return member.full_name || member.email || `user:${member.user_id.slice(0, 6)}`;
}

export function ChatWidget({ workspaceId, workspaceName, canModerate }: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [connected, setConnected] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState(0);
  const [members, setMembers] = useState<WorkspaceMemberWithProfile[]>([]);
  const [showMembers, setShowMembers] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const isOpenRef = useRef(false);

  const lastSeenKey = `chat-last-seen:${workspaceId}`;

  const getViewport = useCallback(
    () =>
      rootRef.current?.querySelector<HTMLDivElement>(
        "[data-radix-scroll-area-viewport]",
      ) ?? null,
    [],
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    setShowJumpToLatest(false);
  }, []);

  const markSeen = useCallback(() => {
    const now = Date.now();
    setLastSeenAt(now);
    localStorage.setItem(lastSeenKey, now.toString());
  }, [lastSeenKey]);

  useEffect(() => {
    getCurrentUser().then(setUser);
  }, []);

  // The chat roster mirrors the Team page: workspace members are the people
  // who appear here and are allowed to chat (enforced server-side by RLS).
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setMembers([]);
    setShowMembers(false);
    listWorkspaceMembers(workspaceId, { statuses: ["active", "invited"] })
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((err) => console.error("Failed to load team members", err));
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.status === "active"),
    [members],
  );

  // Unread badge is derived — survives reloads via the persisted last-seen
  // timestamp instead of a separately maintained (and drift-prone) counter.
  const unreadCount = useMemo(() => {
    if (isOpen) return 0;
    return messages.filter(
      (m) =>
        new Date(m.created_at).getTime() > lastSeenAt &&
        m.user_id !== user?.id,
    ).length;
  }, [messages, lastSeenAt, isOpen, user?.id]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;

    const stored = parseInt(localStorage.getItem(lastSeenKey) ?? "0", 10);
    setLastSeenAt(Number.isFinite(stored) ? stored : 0);
    setMessages([]);
    setHasMore(false);

    const loadMessages = async () => {
      try {
        const page = await listChatMessages(workspaceId);
        if (cancelled) return;
        setMessages(page.messages);
        setHasMore(page.hasMore);
      } catch (err) {
        console.error("Failed to load messages", err);
        if (!cancelled) setError("Failed to load messages.");
      }
    };

    loadMessages();

    const unsubscribe = subscribeWorkspaceChat(workspaceId, {
      onInsert: (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg].sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime(),
          );
        });
        if (isOpenRef.current && !nearBottomRef.current) {
          setShowJumpToLatest(true);
        }
      },
      onDelete: (id) => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      },
      onStatus: (ok) => setConnected(ok),
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [workspaceId, lastSeenKey]);

  // Track whether the user is reading the latest messages so realtime
  // arrivals don't yank the scroll position away from older history.
  useEffect(() => {
    if (!isOpen) return;
    const viewport = getViewport();
    if (!viewport) return;

    const onScroll = () => {
      const near =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
        NEAR_BOTTOM_PX;
      nearBottomRef.current = near;
      if (near) setShowJumpToLatest(false);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [isOpen, getViewport]);

  // Auto-scroll on new messages only when already reading the latest.
  useEffect(() => {
    if (!isOpen) return;
    if (nearBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom());
      markSeen();
    }
  }, [messages, isOpen, scrollToBottom, markSeen]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    isOpenRef.current = open;
    if (open) {
      markSeen();
      nearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom());
      // Clear any chat notifications from the bell — the user is reading now.
      markChatNotificationsRead(workspaceId).catch(() => {});
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputValue.trim();
    if (!text || isSending || !user) return;

    setIsSending(true);
    setError(null);

    try {
      const row = await sendChatMessage(workspaceId, text);
      setInputValue("");
      // Append immediately instead of waiting for the realtime echo
      // (which dedupes by id when it arrives).
      const senderName =
        (user.user_metadata?.full_name as string | undefined) ??
        user.email ??
        "You";
      setMessages((prev) =>
        prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, senderName }],
      );
      nearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom("smooth"));
      // Fire-and-forget: surface the message in teammates' notification bells.
      void notifyChatMessage({
        workspaceId,
        senderName,
        preview: text,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleLoadOlder = async () => {
    if (!hasMore || isLoadingOlder || messages.length === 0) return;
    setIsLoadingOlder(true);
    const viewport = getViewport();
    const prevHeight = viewport?.scrollHeight ?? 0;

    try {
      const page = await listChatMessages(workspaceId, messages[0].created_at);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...page.messages.filter((m) => !known.has(m.id)), ...prev];
      });
      setHasMore(page.hasMore);
      // Keep the reading position anchored after older messages prepend.
      requestAnimationFrame(() => {
        const vp = getViewport();
        if (vp) vp.scrollTop = vp.scrollHeight - prevHeight;
      });
    } catch {
      setError("Failed to load earlier messages.");
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const handleDelete = async (msgId: string) => {
    if (!confirm("Delete this message?")) return;
    try {
      await deleteChatMessage(msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch {
      setError("Failed to delete message.");
    }
  };

  const formatTime = (dateStr: string) => {
    return format(new Date(dateStr), "p");
  };

  const formatDayLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "PPP");
  };

  return (
    <>
      <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 sm:bottom-6 sm:right-6">
        <div className="relative">
          {unreadCount > 0 && (
            <span
              className="absolute inset-0 rounded-full bg-primary/40 animate-ping"
              aria-hidden
            />
          )}
          <Button
            size="icon"
            aria-label={
              unreadCount > 0
                ? `Open team chat, ${unreadCount} unread ${unreadCount === 1 ? "message" : "messages"}`
                : "Open team chat"
            }
            className={cn(
              "relative h-14 w-14 rounded-full shadow-2xl transition-all hover:scale-110 active:scale-95",
              unreadCount > 0 && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background"
            )}
            onClick={() => handleOpenChange(true)}
          >
            <MessageSquare className="h-6 w-6" />
            {unreadCount > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-1 -right-1 h-6 w-6 flex items-center justify-center p-0 text-[10px] rounded-full border-2 border-background animate-in zoom-in duration-200"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </Badge>
            )}
          </Button>
        </div>
      </div>

      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
        <SheetContent side="right" className="flex flex-col w-full sm:max-w-[420px] p-0">
          <SheetHeader className="p-4 pr-12 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative shrink-0">
                <Avatar className="h-11 w-11 border shadow-sm">
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                    {initials(workspaceName || "Workspace")}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background",
                    connected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                  )}
                  aria-hidden
                />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <SheetTitle className="text-base leading-tight truncate">
                  Team Chat
                </SheetTitle>
                <SheetDescription className="text-xs truncate">
                  {workspaceName || "Workspace"}
                  <span className="mx-1.5 opacity-50">·</span>
                  {connected ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Live
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      Reconnecting…
                    </span>
                  )}
                </SheetDescription>
              </div>

              <button
                type="button"
                onClick={() => setShowMembers((v) => !v)}
                aria-expanded={showMembers}
                aria-label={`Show team members (${activeMembers.length})`}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border bg-background/70 py-1.5 pl-1.5 pr-2.5 shadow-sm transition-colors hover:bg-background sm:py-1",
                  showMembers && "border-primary/40 bg-background ring-2 ring-primary/15"
                )}
              >
                <div className="flex -space-x-2">
                  {activeMembers.slice(0, 3).map((m) => (
                    <Avatar key={m.id} className="h-6 w-6 border-2 border-background">
                      <AvatarFallback
                        className={cn("text-[9px] font-semibold", avatarColor(m.user_id))}
                      >
                        {initials(memberDisplayName(m))}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {activeMembers.length === 0 && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                      <Users className="h-3 w-3 text-muted-foreground" />
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {activeMembers.length}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-muted-foreground transition-transform",
                    showMembers && "rotate-180"
                  )}
                />
              </button>
            </div>
          </SheetHeader>

          {showMembers && (
            <div className="border-b bg-muted/30">
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Team members · {activeMembers.length}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <ul className="px-2 pb-2">
                  {members.length === 0 && (
                    <li className="px-2 py-3 text-xs text-muted-foreground">
                      No team members yet — add teammates from the Team page to
                      chat together.
                    </li>
                  )}
                  {members.map((m) => {
                    const isMe = m.user_id === user?.id;
                    const name = memberDisplayName(m);
                    const invited = m.status === "invited";
                    return (
                      <li
                        key={m.id}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-background/80"
                      >
                        <Avatar className="h-7 w-7 border">
                          <AvatarFallback
                            className={cn(
                              "text-[9px] font-semibold",
                              isMe
                                ? "bg-primary text-primary-foreground"
                                : avatarColor(m.user_id)
                            )}
                          >
                            {initials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {name}
                            {isMe && (
                              <span className="ml-1 text-muted-foreground font-normal">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {roleLabel(m.role)}
                          </p>
                        </div>
                        {invited ? (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 text-amber-600 border-amber-500/40"
                          >
                            Invited
                          </Badge>
                        ) : (
                          <span
                            className="h-2 w-2 rounded-full bg-emerald-500/70"
                            title="Active member"
                            aria-hidden
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {!connected && (
            <div className="flex items-center gap-2 px-4 py-1.5 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-b">
              <WifiOff className="h-3.5 w-3.5" />
              Connection lost — messages will sync once we're back online.
            </div>
          )}

          <div className="relative flex-1 min-h-0 bg-muted/20">
            <ScrollArea ref={rootRef} className="h-full">
              <div className="flex flex-col p-4">
                {hasMore && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-center mb-4 h-9 rounded-full px-4 text-[11px] text-muted-foreground bg-background/80 backdrop-blur sm:h-7 sm:px-3"
                    onClick={handleLoadOlder}
                    disabled={isLoadingOlder}
                  >
                    {isLoadingOlder ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Loading…
                      </>
                    ) : (
                      "Load earlier messages"
                    )}
                  </Button>
                )}
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <MessageCircle className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    No messages yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Start the conversation with your team.
                  </p>
                </div>
              )}
              {messages.map((msg, index) => {
                const isMe = msg.user_id === user?.id;
                const msgDate = new Date(msg.created_at);
                const prev = index > 0 ? messages[index - 1] : null;
                const showDaySeparator =
                  !prev || !isSameDay(msgDate, new Date(prev.created_at));
                const isGroupStart =
                  showDaySeparator ||
                  !prev ||
                  prev.user_id !== msg.user_id ||
                  msgDate.getTime() - new Date(prev.created_at).getTime() >
                    GROUP_WINDOW_MS;
                const canDelete = isMe || canModerate;
                return (
                  <div
                    key={msg.id}
                    className={cn(
                      index === 0
                        ? ""
                        : isGroupStart
                          ? "mt-4"
                          : "mt-0.5"
                    )}
                  >
                    {showDaySeparator && (
                      <div className="flex items-center gap-3 py-2 mb-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="rounded-full border bg-background px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm">
                          {formatDayLabel(msgDate)}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    )}
                  <div
                    className={cn(
                      "flex gap-2.5 group",
                      isMe ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    {isGroupStart ? (
                      <Avatar className="h-8 w-8 flex-shrink-0 mt-5 border shadow-sm">
                        <AvatarFallback
                          className={cn(
                            "text-[10px] font-semibold",
                            isMe
                              ? "bg-primary text-primary-foreground"
                              : avatarColor(msg.user_id)
                          )}
                        >
                          {initials(msg.senderName)}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className="w-8 flex-shrink-0" />
                    )}

                    <div className={cn(
                      "flex min-w-0 flex-col max-w-[75%]",
                      isMe ? "items-end" : "items-start"
                    )}>
                      {isGroupStart && (
                        <div
                          className={cn(
                            "flex items-baseline gap-2 mb-1",
                            isMe && "flex-row-reverse"
                          )}
                        >
                          <span className="text-xs font-semibold text-foreground/80 truncate max-w-[180px]">
                            {isMe ? "You" : msg.senderName}
                          </span>
                          <span className="text-[10px] text-muted-foreground/70">
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                      )}

                      <div
                        className={cn(
                          "flex items-center gap-1",
                          isMe ? "flex-row-reverse" : "flex-row"
                        )}
                      >
                        <div
                          title={formatTime(msg.created_at)}
                          className={cn(
                            "min-w-0 px-3.5 py-2 text-sm whitespace-pre-wrap break-words shadow-sm transition-shadow group-hover:shadow",
                            isMe
                              ? "bg-primary text-primary-foreground rounded-2xl"
                              : "bg-background border text-foreground rounded-2xl",
                            isGroupStart &&
                              (isMe ? "rounded-tr-md" : "rounded-tl-md")
                          )}
                        >
                          {msg.content}
                        </div>

                        {canDelete && (
                          <button
                            onClick={() => handleDelete(msg.id)}
                            aria-label="Delete message"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive sm:h-auto sm:w-auto sm:p-1.5 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  </div>
                );
              })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {showJumpToLatest && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 h-9 rounded-full px-4 shadow-lg text-xs"
                onClick={() => scrollToBottom("smooth")}
              >
                <ChevronDown className="h-3.5 w-3.5 mr-1" />
                New messages
              </Button>
            )}
          </div>

          <div className="p-3 border-t bg-background">
            {error && (
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="shrink-0 rounded px-1 py-0.5 font-medium underline-offset-2 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}
            <form
              onSubmit={handleSendMessage}
              className="flex items-end gap-1.5 rounded-2xl border bg-muted/40 p-1.5 transition-colors focus-within:border-primary/50 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/15"
            >
              <Textarea
                placeholder="Write a message…"
                value={inputValue}
                onChange={(e) =>
                  setInputValue(e.target.value.slice(0, MAX_MESSAGE_LENGTH))
                }
                onKeyDown={handleInputKeyDown}
                disabled={isSending}
                rows={1}
                aria-label="Chat message"
                className="flex-1 min-h-[40px] max-h-32 resize-none border-0 bg-transparent px-2.5 py-2 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-sm"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!inputValue.trim() || isSending}
                aria-label="Send message"
                className="h-10 w-10 shrink-0 rounded-xl sm:h-9 sm:w-9"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
            <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground/60">
              <span>Enter to send · Shift+Enter for a new line</span>
              {inputValue.length > MAX_MESSAGE_LENGTH - 200 && (
                <span
                  className={cn(
                    inputValue.length >= MAX_MESSAGE_LENGTH &&
                      "text-destructive font-medium"
                  )}
                >
                  {MAX_MESSAGE_LENGTH - inputValue.length} left
                </span>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
