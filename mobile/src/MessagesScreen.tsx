import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import {
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
import { colors, scale, FONT_SCALE_CAP } from "./ui"

/** Matches the body column, so nothing typed here is silently truncated. */
const MAX = 2000

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
export function MessagesScreen({ user, onUnread }: { user: SessionUser; onUnread: (n: number) => void }) {
  const [threads, setThreads] = useState<MessageThread[] | null>(null)
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [openWith, setOpenWith] = useState<{ id: number; name: string } | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const listRef = useRef<FlatList<Message>>(null)
  const insets = useSafeAreaInsets()

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
    await loadMessages(id)
  }

  async function send() {
    const body = draft.trim()
    if (!body || !openWith || sending) return
    setSending(true)
    try {
      await sendMessage(openWith.id, body)
      setDraft("")
      await loadMessages(openWith.id)
      await loadThreads()
    } catch {
      // Left in the box rather than thrown away: retyping a message the app
      // lost is worse than a send that visibly did not go.
    } finally {
      setSending(false)
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
            <ActivityIndicator color={colors.brand} />
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
              return (
                <View style={[styles.bubbleRow, mine ? styles.right : styles.left]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text
                      maxFontSizeMultiplier={FONT_SCALE_CAP}
                      style={[styles.bubbleText, mine && styles.mineText]}
                    >
                      {item.body}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={FONT_SCALE_CAP}
                      style={[styles.stamp, mine && styles.mineStamp]}
                    >
                      {clock(item.created_at)}
                      {mine && item.read_at ? " · read" : ""}
                    </Text>
                  </View>
                </View>
              )
            }}
          />
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
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="send" size={scale(18)} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
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
            color={colors.brand}
          />
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows ?? []}
        keyExtractor={(r: MessageThread | Contact) => String(r.user_id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
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
              <ActivityIndicator color={colors.brand} />
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

const styles = StyleSheet.create({
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
  avatarText: { color: "#fff", fontWeight: "700", fontSize: scale(14) },
  avatarSm: {
    width: scale(30),
    height: scale(30),
    borderRadius: scale(15),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmText: { color: "#fff", fontWeight: "700", fontSize: scale(11) },

  unread: {
    minWidth: scale(22),
    height: scale(22),
    borderRadius: scale(11),
    paddingHorizontal: scale(6),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadText: { color: "#fff", fontSize: scale(11), fontWeight: "700" },

  thread: { padding: scale(14), gap: scale(8), flexGrow: 1, justifyContent: "flex-end" },
  bubbleRow: { flexDirection: "row" },
  left: { justifyContent: "flex-start" },
  right: { justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: scale(16), paddingHorizontal: scale(13), paddingVertical: scale(9) },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: scale(4) },
  theirs: { backgroundColor: colors.card, borderBottomLeftRadius: scale(4), borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  bubbleText: { fontSize: scale(14), lineHeight: scale(20), color: colors.text },
  mineText: { color: "#fff" },
  stamp: { fontSize: scale(10), color: colors.faint, marginTop: scale(4), textAlign: "right" },
  mineStamp: { color: "rgba(255,255,255,0.75)" },

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
