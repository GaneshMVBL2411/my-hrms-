import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MessageSquarePlus, Search, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { listContacts, listMessages, listThreads, markThreadRead, sendMessage } from "@/features/messages/api"
import { useAuth } from "@/features/auth/AuthContext"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** Matches the body column, so nothing typed here is silently truncated. */
const MAX = 2000

/** "14:32" for today, "3 Sep" for anything older — the two things a reader wants. */
function whenLabel(iso: string) {
  const at = new Date(iso)
  const today = new Date().toDateString() === at.toDateString()
  return today
    ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleDateString([], { day: "numeric", month: "short" })
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
}

/**
 * Internal messages between HR and an employee.
 *
 * Deliberately the same screen for both sides. HR opens it to raise something
 * — a leave decision, a document that is missing — and the employee opens the
 * same page to read it and answer; there is no separate "employee view" to keep
 * in step, and nothing HR can see here that the other person cannot.
 *
 * Left: the conversations you already have. Right: the one you are reading.
 * Starting a new one switches the left pane to the full contact list rather
 * than opening a dialog, because "who do I want" and "who have I already
 * spoken to" are the same question asked a moment apart.
 */
export function MessagesPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [withUser, setWithUser] = useState<{ id: number; name: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState("")
  const [draft, setDraft] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  const { data: threads, isLoading: loadingThreads } = useQuery({
    queryKey: ["messages", "threads"],
    queryFn: listThreads,
    // A conversation is only useful if the other side's reply turns up without
    // a page reload. Polling rather than a socket: this is a handful of rows
    // and a dozen people, and a connection to keep alive would be the larger
    // moving part.
    refetchInterval: 15_000,
  })

  const { data: contacts } = useQuery({
    queryKey: ["messages", "contacts"],
    queryFn: listContacts,
    enabled: picking,
  })

  const { data: messages, isLoading: loadingMessages } = useQuery({
    queryKey: ["messages", "thread", withUser?.id],
    queryFn: () => listMessages(withUser!.id),
    enabled: withUser !== null,
    refetchInterval: 10_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["messages"] })

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendMessage(withUser!.id, body),
    onSuccess: () => {
      setDraft("")
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error, "Could not send the message")),
  })

  // Opening a thread is what marks it read — the same thing that happens when
  // someone actually reads it. Failing silently is right here: a badge that
  // stays lit is a far smaller problem than an error toast over a conversation.
  const unreadHere = useMemo(
    () => messages?.some((m) => m.senderId === withUser?.id && m.readAt === null) ?? false,
    [messages, withUser]
  )
  useEffect(() => {
    if (!withUser || !unreadHere) return
    markThreadRead(withUser.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["messages"] }))
      .catch(() => {})
  }, [withUser, unreadHere, queryClient])

  // Follow the conversation down as it grows, the way every chat does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages?.length, withUser?.id])

  const filteredContacts = (contacts ?? []).filter((c) =>
    `${c.name} ${c.designation} ${c.department}`.toLowerCase().includes(search.toLowerCase())
  )

  const send = () => {
    const body = draft.trim()
    if (!body || !withUser || sendMutation.isPending) return
    sendMutation.mutate(body)
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Messages</h1>
          <p className="text-sm text-muted-foreground">
            Direct, one to one. Only you and the person you are writing to can read a conversation.
          </p>
        </div>
        <Button
          className="rounded-md"
          onClick={() => {
            setPicking(true)
            setSearch("")
          }}
        >
          <MessageSquarePlus className="mr-2 size-4" />
          New message
        </Button>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[20rem_1fr]">
        {/* ------------------------------------------------ left: who */}
        <div className="flex max-h-[34rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
          {picking ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people"
                  className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
                />
                <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
                  Cancel
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredContacts.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">No one matches that.</p>
                )}
                {filteredContacts.map((c) => (
                  <button
                    key={c.userId}
                    type="button"
                    className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/60"
                    onClick={() => {
                      setWithUser({ id: c.userId, name: c.name })
                      setPicking(false)
                    }}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[c.designation, c.department].filter(Boolean).join(" · ") || c.role.replace("_", " ")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {loadingThreads && <Skeleton className="m-3 h-16 rounded-md" />}
              {!loadingThreads && (threads?.length ?? 0) === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No conversations yet. Start one with <span className="text-foreground">New message</span>.
                </p>
              )}
              {threads?.map((t) => (
                <button
                  key={t.userId}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left hover:bg-muted/60",
                    withUser?.id === t.userId && "bg-muted"
                  )}
                  onClick={() => setWithUser({ id: t.userId, name: t.name })}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(t.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{whenLabel(t.lastAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.lastBody}</span>
                      {t.unread > 0 && (
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                          {t.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* -------------------------------------- right: the conversation */}
        <div className="flex max-h-[34rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
          {!withUser ? (
            <div className="grid flex-1 place-items-center px-6 py-16 text-center">
              <p className="max-w-sm text-sm text-muted-foreground">
                Pick a conversation, or start a new one. Messages here are private to the two of you — nobody
                else in the company can read them.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {initials(withUser.name)}
                </span>
                <p className="font-medium text-foreground">{withUser.name}</p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {loadingMessages && <Skeleton className="h-16 w-2/3 rounded-md" />}
                {!loadingMessages && (messages?.length ?? 0) === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nothing yet — write the first message.
                  </p>
                )}
                {messages?.map((m) => {
                  const mine = m.senderId === user?.id
                  return (
                    <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[70%]",
                          mine
                            ? "rounded-br-sm bg-primary text-primary-foreground"
                            : "rounded-bl-sm bg-muted text-foreground"
                        )}
                      >
                        {/* whitespace-pre-wrap: paragraphs someone typed on
                            purpose should survive being sent. A withdrawn
                            message keeps its place and loses its text — the
                            view returns null for the body, so this is the
                            only thing left to say about it. */}
                        <p
                          className={cn(
                            "whitespace-pre-wrap break-words",
                            m.deletedAt && "italic opacity-70"
                          )}
                        >
                          {m.deletedAt ? "This message was deleted" : m.body}
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-right text-[11px]",
                            mine ? "text-primary-foreground/70" : "text-muted-foreground"
                          )}
                        >
                          {m.editedAt && !m.deletedAt && "edited · "}
                          {whenLabel(m.createdAt)}
                          {mine && m.readAt && " · read"}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={endRef} />
              </div>

              <div className="flex items-end gap-2 border-t border-border px-3 py-3">
                <Textarea
                  value={draft}
                  maxLength={MAX}
                  rows={1}
                  placeholder={`Message ${withUser.name}`}
                  className="max-h-32 min-h-10 flex-1 resize-none"
                  onChange={(e) => setDraft(e.target.value)}
                  // Enter sends, Shift+Enter breaks the line — what every chat
                  // does, and the reason a paragraph is still possible.
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                />
                <Button
                  size="icon"
                  className="shrink-0 rounded-md"
                  disabled={!draft.trim() || sendMutation.isPending}
                  onClick={send}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
