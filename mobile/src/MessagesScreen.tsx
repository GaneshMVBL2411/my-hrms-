import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import {
  deleteMessage,
  editMessage,
  markThreadRead,
  messageContacts,
  messagesWith,
  messageThreads,
  sendMessage,
  type Contact,
  type Message,
  type MessageThread,
  type SessionUser,
} from "./api"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"

/** Matches the body column, so nothing typed here is silently truncated. */
const MAX = 2000

/**
 * How long the database will accept an amendment, mirrored here.
 *
 * Duplicated deliberately, and only to decide whether to *offer* the option:
 * the window that matters is the one in migration 0030, which refuses a late
 * edit whatever this client believes. Showing "Edit" on a message the server
 * will reject is a worse experience than not showing it.
 */
const EDIT_WINDOW_MS = 15 * 60 * 1000
const DELETE_WINDOW_MS = 60 * 60 * 1000

/**
 * A message this device is still trying to send.
 *
 * Kept apart from the loaded rows because it has no server id yet and must not
 * be confused with one. A failed send stays in the thread where it was typed —
 * WhatsApp's behaviour, and better than the old one, which silently returned
 * the text to the input box and left no trace that anything had gone.
 */
interface Outgoing {
  localId: string
  body: string
  failed: boolean
}

/**
 * HR and an employee, talking directly.
 *
 * The same conversation as the portal's Messages page — same table, same
 * policies — but this is the side that matters most: HR raises something from a
 * desk, and the person it concerns is holding a phone. A message only they can
 * read is no use if the only place to read it is a laptop they do not have.
 *
 * Two views in one screen rather than a navigator: the list of people, and the
 * conversation with one of them. Back returns to the list, which is the whole
 * navigation this needs.
 */
export function MessagesScreen({
  active,
  user,
  onUnread,
}: {
  /**
   * Whether this tab is the one on screen. The tabs all stay mounted, so a back
   * press arrives here even when someone is elsewhere in the app.
   */
  active: boolean
  user: SessionUser
  onUnread: (n: number) => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [threads, setThreads] = useState<MessageThread[] | null>(null)
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [openWith, setOpenWith] = useState<{ id: number; name: string } | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [outgoing, setOutgoing] = useState<Outgoing[]>([])
  const [editing, setEditing] = useState<Message | null>(null)
  const [acting, setActing] = useState<Message | Outgoing | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const listRef = useRef<FlatList<Message>>(null)
  const insets = useSafeAreaInsets()

  /**
   * Back unwinds the conversation one step at a time, innermost first.
   *
   * The long-press sheet is a Modal and handles its own back press, so it is
   * not listed here — Android dismisses it before this handler ever runs.
   */
  useEffect(() => {
    if (!active) return
    if (!openWith && !picking && !editing) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (editing) {
        setEditing(null)
        setDraft("")
        return true
      }
      if (openWith) {
        setOpenWith(null)
        return true
      }
      if (picking) {
        setPicking(false)
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [active, openWith, picking, editing])

  const loadThreads = useCallback(async () => {
    const rows = await messageThreads().catch(() => [])
    setThreads(rows)
    onUnread(rows.reduce((total, t) => total + Number(t.unread || 0), 0))
  }, [onUnread, user.id])

  const loadMessages = useCallback(async (withId: number) => {
    setMessages(await messagesWith(withId).catch(() => []))
  }, [])

  useEffect(() => {
    loadThreads()
    // A conversation is no use if the reply only turns up on a cold start.
    // Polling rather than a socket: a handful of rows and a dozen people is not
    // worth a connection to keep alive.
    const timer = setInterval(() => {
      loadThreads()
      if (openWith) loadMessages(openWith.id)
    }, 15000)
    return () => clearInterval(timer)
  }, [loadThreads, loadMessages, openWith])

  // Opening a thread is what marks it read — the same thing that happens when
  // someone actually reads it. A failure here is silently ignored: a badge that
  // stays lit is a smaller problem than an error over a conversation.
  useEffect(() => {
    if (!openWith || !messages) return
    if (!messages.some((m) => m.sender_id === openWith.id && m.read_at === null)) return
    markThreadRead(openWith.id)
      .then(loadThreads)
      .catch(() => {})
  }, [openWith, messages, loadThreads])

  async function open(id: number, name: string) {
    setOpenWith({ id, name })
    setPicking(false)
    setMessages(null)
    // An edit belongs to the conversation it was started in, and a queued
    // message to the person it was addressed to. Neither should follow you.
    setEditing(null)
    setOutgoing([])
    setDraft("")
    await loadMessages(id)
  }

  /**
   * Sends, or applies an edit if one is in progress.
   *
   * The composer does both because that is where the text already is, and a
   * second box for edits would be a second thing to learn for the same task.
   */
  async function send() {
    const body = draft.trim()
    if (!body || !openWith || sending) return

    if (editing) {
      const target = editing
      setSending(true)
      try {
        await editMessage(target.id, body)
        setDraft("")
        setEditing(null)
        await loadMessages(openWith.id)
        await loadThreads()
      } catch (e) {
        Alert.alert("Not changed", (e as Error).message || "That edit could not be saved.")
      } finally {
        setSending(false)
      }
      return
    }

    // Shown immediately with a clock against it, so the thread reflects what
    // was typed before the round trip finishes.
    const localId = `local-${Date.now()}`
    setOutgoing((q) => [...q, { localId, body, failed: false }])
    setDraft("")
    await deliver(localId, body, openWith.id)
  }

  /**
   * One attempt at putting a queued message on the server.
   *
   * Split out from send() so Resend can reuse it: a retry is the same request,
   * and the only difference is that the row is already on screen.
   */
  async function deliver(localId: string, body: string, toId: number) {
    setOutgoing((q) => q.map((o) => (o.localId === localId ? { ...o, failed: false } : o)))
    try {
      await sendMessage(toId, body)
      setOutgoing((q) => q.filter((o) => o.localId !== localId))
      await loadMessages(toId)
      await loadThreads()
    } catch {
      // Kept in the thread and marked, rather than dropped or silently
      // returned to the input box — a send that did not go should say so.
      setOutgoing((q) => q.map((o) => (o.localId === localId ? { ...o, failed: true } : o)))
    }
  }

  /** Discards a failed message. Nothing reached the server, so nothing is withdrawn. */
  function discard(localId: string) {
    setOutgoing((q) => q.filter((o) => o.localId !== localId))
  }

  async function withdraw(message: Message) {
    if (!openWith) return
    try {
      await deleteMessage(message.id)
      await loadMessages(openWith.id)
      await loadThreads()
    } catch (e) {
      Alert.alert("Not deleted", (e as Error).message || "That message could not be deleted.")
    }
  }

  // ------------------------------------------------------- the conversation
  if (openWith) {
    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <View style={[styles.bar, { paddingTop: insets.top + scale(8) }]}>
          <TouchableOpacity onPress={() => setOpenWith(null)} hitSlop={12}>
            <Ionicons name="chevron-back" size={scale(24)} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.avatarSm}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.avatarSmText}>
              {initials(openWith.name)}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.barTitle}>
            {openWith.name}
          </Text>
        </View>

        {messages === null ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.thread}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
                Nothing yet — write the first message.
              </Text>
            }
            renderItem={({ item }) => {
              const mine = item.sender_id === user.id
              const gone = item.deleted_at !== null
              return (
                <Bubble
                  mine={mine}
                  gone={gone}
                  body={gone ? "This message was deleted" : (item.body ?? "")}
                  stamp={clock(item.created_at)}
                  edited={item.edited_at !== null && !gone}
                  tick={mine && !gone ? (item.read_at ? "read" : "sent") : null}
                  // Only your own messages, and only while they can still be
                  // changed — an option that always fails is worse than none.
                  onLongPress={mine && !gone && actionable(item) ? () => setActing(item) : undefined}
                />
              )
            }}
            ListFooterComponent={
              outgoing.length === 0 ? null : (
                <>
                  {outgoing.map((o) => (
                    <Bubble
                      key={o.localId}
                      mine
                      gone={false}
                      body={o.body}
                      stamp={o.failed ? "Not sent" : "Sending…"}
                      edited={false}
                      tick={o.failed ? "failed" : "pending"}
                      onLongPress={() => setActing(o)}
                      onPress={o.failed ? () => deliver(o.localId, o.body, openWith.id) : undefined}
                    />
                  ))}
                </>
              )
            }
          />
        )}

        {editing && (
          <View style={styles.editingBar}>
            <Ionicons name="pencil" size={scale(15)} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.editingTitle}>
                Editing message
              </Text>
              <Text
                maxFontSizeMultiplier={FONT_SCALE_CAP}
                numberOfLines={1}
                style={styles.editingBody}
              >
                {editing.body}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setEditing(null)
                setDraft("")
              }}
              hitSlop={10}
            >
              <Ionicons name="close" size={scale(19)} color={colors.faint} />
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.composer, { paddingBottom: insets.bottom + scale(8) }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${openWith.name}`}
            placeholderTextColor={colors.faint}
            maxLength={MAX}
            multiline
            maxFontSizeMultiplier={FONT_SCALE_CAP}
          />
          <TouchableOpacity
            style={[styles.send, (!draft.trim() || sending) && { opacity: 0.4 }]}
            onPress={send}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color={colors.onFill} size="small" />
            ) : (
              <Ionicons name="send" size={scale(18)} color={colors.onFill} />
            )}
          </TouchableOpacity>
        </View>

        <ActionSheet
          target={acting}
          onClose={() => setActing(null)}
          onEdit={(m) => {
            setEditing(m)
            setDraft(m.body ?? "")
          }}
          onDelete={withdraw}
          onResend={(o) => openWith && deliver(o.localId, o.body, openWith.id)}
          onDiscard={(o) => discard(o.localId)}
        />
      </KeyboardAvoidingView>
    )
  }

  // ------------------------------------------------------------- the people
  const rows = picking ? contacts : threads

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + scale(8) }]}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.barTitle}>
          {picking ? "Choose someone" : "Messages"}
        </Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={async () => {
            if (picking) return setPicking(false)
            setPicking(true)
            if (contacts === null) setContacts(await messageContacts().catch(() => []))
          }}
          hitSlop={10}
        >
          <Ionicons
            name={picking ? "close" : "create-outline"}
            size={scale(20)}
            color={colors.accent}
          />
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows ?? []}
        keyExtractor={(r: MessageThread | Contact) => String(r.user_id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={async () => {
              setRefreshing(true)
              await loadThreads()
              setRefreshing(false)
            }}
          />
        }
        ListEmptyComponent={
          rows === null ? (
            <View style={styles.centre}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
              {picking
                ? "No one to message."
                : "No conversations yet. Tap the pencil to start one."}
            </Text>
          )
        }
        renderItem={({ item }) => {
          const thread = "unread" in item ? item : null
          const contact = thread ? null : (item as Contact)
          return (
            <TouchableOpacity
              style={styles.person}
              onPress={() => open(item.user_id, item.name)}
              activeOpacity={0.7}
            >
              <View style={styles.avatar}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.avatarText}>
                  {initials(item.name)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.personTop}>
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_CAP}
                    numberOfLines={1}
                    style={styles.personName}
                  >
                    {item.name}
                  </Text>
                  {thread && (
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.personWhen}>
                      {when(thread.last_at)}
                    </Text>
                  )}
                </View>
                <Text
                  maxFontSizeMultiplier={FONT_SCALE_CAP}
                  numberOfLines={1}
                  style={styles.personSub}
                >
                  {thread
                    ? thread.last_body
                    : [contact?.designation, contact?.department].filter(Boolean).join(" · ") ||
                      contact?.role.replace(/_/g, " ")}
                </Text>
              </View>
              {thread && Number(thread.unread) > 0 && (
                <View style={styles.unread}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.unreadText}>
                    {thread.unread}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )
        }}
      />
    </View>
  )
}

/** Whether the server would still accept an amendment to this message. */
function actionable(m: Message): boolean {
  return Date.now() - new Date(m.created_at).getTime() < DELETE_WINDOW_MS
}

function withinEditWindow(m: Message): boolean {
  return Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS
}

/**
 * One message.
 *
 * The tick is the part worth being precise about, because it is a claim about
 * someone else's behaviour:
 *
 *   pending  a clock — this device has not managed to send it yet
 *   failed   a warning, and tapping retries
 *   sent     one tick — the server has it
 *   read     two ticks — the recipient opened the conversation
 *
 * There is deliberately no "delivered" state between sent and read. The server
 * does not know when the other phone received a message, only when the thread
 * was opened, and inventing a tick for something unmeasured would make the
 * other two untrustworthy.
 */
function Bubble({
  mine,
  gone,
  body,
  stamp,
  edited,
  tick,
  onLongPress,
  onPress,
}: {
  mine: boolean
  gone: boolean
  body: string
  stamp: string
  edited: boolean
  tick: "pending" | "failed" | "sent" | "read" | null
  onLongPress?: () => void
  onPress?: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)

  return (
    <Pressable
      onLongPress={onLongPress}
      onPress={onPress}
      delayLongPress={280}
      style={({ pressed }) => [
        styles.bubbleRow,
        mine ? styles.right : styles.left,
        pressed && onLongPress ? { opacity: 0.7 } : null,
      ]}
    >
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs, gone && styles.goneBubble]}>
        <Text
          maxFontSizeMultiplier={FONT_SCALE_CAP}
          style={[styles.bubbleText, mine && styles.mineText, gone && styles.goneText]}
        >
          {body}
        </Text>
        <View style={styles.metaRow}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.stamp, mine && styles.mineStamp]}>
            {edited ? `edited · ${stamp}` : stamp}
          </Text>
          {tick === "pending" && (
            <Ionicons name="time-outline" size={scale(12)} color={colors.onFillMuted} style={styles.tick} />
          )}
          {tick === "failed" && (
            <Ionicons name="alert-circle" size={scale(13)} color={colors.tickFailed} style={styles.tick} />
          )}
          {tick === "sent" && (
            <Ionicons name="checkmark" size={scale(13)} color={colors.onFillMuted} style={styles.tick} />
          )}
          {tick === "read" && (
            <Ionicons name="checkmark-done" size={scale(13)} color={colors.tickRead} style={styles.tick} />
          )}
        </View>
      </View>
    </Pressable>
  )
}

/**
 * What a long press offers, for a sent message or a stuck one.
 *
 * A sheet rather than Alert.alert: Alert caps out at three buttons on iOS and
 * renders as a system dialog, which reads as an error rather than a menu.
 */
function ActionSheet({
  target,
  onClose,
  onEdit,
  onDelete,
  onResend,
  onDiscard,
}: {
  target: Message | Outgoing | null
  onClose: () => void
  onEdit: (m: Message) => void
  onDelete: (m: Message) => void
  onResend: (o: Outgoing) => void
  onDiscard: (o: Outgoing) => void
}) {
  const styles = useStyles(makeStyles)
  const insets = useSafeAreaInsets()
  if (!target) return null

  const queued = "localId" in target
  const sent = queued ? null : (target as Message)

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        {/* Stops a tap inside the sheet closing it on the way through. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + scale(10) }]}
          onPress={() => undefined}
        >
          <View style={styles.sheetGrip} />
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={2} style={styles.sheetQuote}>
            {queued ? (target as Outgoing).body : (sent!.body ?? "")}
          </Text>

          {queued ? (
            <>
              <SheetRow
                icon="refresh"
                label="Resend"
                onPress={() => {
                  onResend(target as Outgoing)
                  onClose()
                }}
              />
              <SheetRow
                icon="trash-outline"
                label="Discard"
                destructive
                onPress={() => {
                  onDiscard(target as Outgoing)
                  onClose()
                }}
              />
            </>
          ) : (
            <>
              {withinEditWindow(sent!) && (
                <SheetRow
                  icon="pencil"
                  label="Edit"
                  hint="Up to 15 minutes after sending"
                  onPress={() => {
                    onEdit(sent!)
                    onClose()
                  }}
                />
              )}
              <SheetRow
                icon="trash-outline"
                label="Delete for everyone"
                hint="Up to an hour after sending"
                destructive
                onPress={() => {
                  onClose()
                  Alert.alert(
                    "Delete this message?",
                    "It stays in the conversation as a deleted message. Neither of you will be able to read it again.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => onDelete(sent!) },
                    ]
                  )
                }}
              />
            </>
          )}

          <SheetRow icon="close" label="Cancel" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function SheetRow({
  icon,
  label,
  hint,
  destructive,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  hint?: string
  destructive?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const tint = destructive ? colors.danger : colors.text

  return (
    <TouchableOpacity style={styles.sheetRow} onPress={onPress}>
      <Ionicons name={icon} size={scale(19)} color={tint} />
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.sheetLabel, { color: tint }]}>
          {label}
        </Text>
        {!!hint && (
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetHint}>
            {hint}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  )
}

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("")
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

/** Time for today, date for anything older — the two things a reader wants. */
function when(iso: string) {
  const at = new Date(iso)
  return new Date().toDateString() === at.toDateString()
    ? clock(iso)
    : at.toLocaleDateString([], { day: "numeric", month: "short" })
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { paddingVertical: scale(40), alignItems: "center" },
  empty: { textAlign: "center", color: colors.muted, fontSize: scale(13), padding: scale(30) },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    paddingHorizontal: scale(16),
    paddingBottom: scale(10),
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  barTitle: { flex: 1, fontSize: scale(18), fontWeight: "700", color: colors.text },
  newBtn: { padding: scale(4) },

  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(12),
    paddingHorizontal: scale(16),
    paddingVertical: scale(12),
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  personTop: { flexDirection: "row", alignItems: "baseline", gap: scale(8) },
  personName: { flex: 1, fontSize: scale(15), fontWeight: "600", color: colors.text },
  personWhen: { fontSize: scale(11), color: colors.faint },
  personSub: { fontSize: scale(12), color: colors.muted, marginTop: scale(2) },

  avatar: {
    width: scale(42),
    height: scale(42),
    borderRadius: scale(21),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onFill, fontWeight: "700", fontSize: scale(14) },
  avatarSm: {
    width: scale(30),
    height: scale(30),
    borderRadius: scale(15),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmText: { color: colors.onFill, fontWeight: "700", fontSize: scale(11) },

  unread: {
    minWidth: scale(22),
    height: scale(22),
    borderRadius: scale(11),
    paddingHorizontal: scale(6),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: colors.onFill, fontSize: scale(11), fontWeight: "700" },

  thread: { padding: scale(14), gap: scale(8), flexGrow: 1, justifyContent: "flex-end" },
  bubbleRow: { flexDirection: "row" },
  left: { justifyContent: "flex-start" },
  right: { justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: scale(16), paddingHorizontal: scale(13), paddingVertical: scale(9) },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: scale(4) },
  theirs: { backgroundColor: colors.card, borderBottomLeftRadius: scale(4), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  bubbleText: { fontSize: scale(14), lineHeight: scale(20), color: colors.text },
  mineText: { color: colors.onFill },
  goneBubble: { backgroundColor: colors.subtle, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  goneText: { color: colors.subtleText, fontStyle: "italic" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: scale(4), marginTop: scale(3) },
  tick: { marginTop: scale(1) },

  editingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    paddingHorizontal: scale(14),
    paddingVertical: scale(9),
    backgroundColor: colors.subtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  editingTitle: { fontSize: scale(12), fontWeight: "700", color: colors.accent },
  editingBody: { fontSize: scale(12), color: colors.muted, marginTop: scale(1) },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: scale(18),
    borderTopRightRadius: scale(18),
    paddingHorizontal: scale(10),
    paddingTop: scale(8),
  },
  sheetGrip: {
    alignSelf: "center",
    width: scale(38),
    height: scale(4),
    borderRadius: scale(2),
    backgroundColor: colors.border,
    marginBottom: scale(10),
  },
  sheetQuote: {
    fontSize: scale(12.5),
    color: colors.muted,
    paddingHorizontal: scale(12),
    paddingBottom: scale(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(14),
    paddingHorizontal: scale(12),
    paddingVertical: scale(13),
  },
  sheetLabel: { fontSize: scale(15), fontWeight: "600" },
  sheetHint: { fontSize: scale(11.5), color: colors.faint, marginTop: scale(1) },
  stamp: { fontSize: scale(10), color: colors.faint, marginTop: scale(4), textAlign: "right" },
  mineStamp: { color: colors.onFillMuted },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: scale(8),
    paddingHorizontal: scale(12),
    paddingTop: scale(8),
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: scale(110),
    minHeight: scale(44),
    borderRadius: scale(22),
    paddingHorizontal: scale(16),
    paddingTop: scale(11),
    paddingBottom: scale(11),
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    fontSize: scale(14),
    color: colors.text,
  },
  send: {
    width: scale(44),
    height: scale(44),
    borderRadius: scale(22),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
})
