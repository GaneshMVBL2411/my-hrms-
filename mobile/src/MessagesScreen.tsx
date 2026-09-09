import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import * as ImagePicker from "expo-image-picker"
import * as DocumentPicker from "expo-document-picker"
import * as Location from "expo-location"
import * as Sharing from "expo-sharing"
import * as MediaLibrary from "expo-media-library/legacy"
import * as FileSystem from "expo-file-system/legacy"
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  createAudioPlayer,
  type AudioPlayer,
} from "expo-audio"
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
import { useKeyboard } from "./keyboard"

/** Matches the body column, so nothing typed here is silently truncated. */
const MAX = 2000

const EMOJI_CATEGORIES = {
  popular: {
    label: "Popular",
    icon: "flame-outline" as const,
    emojis: ["😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "👍", "👎", "🙌", "👏", "❤️", "🔥", "🎉", "✨", "💯", "🙏", "💪", "🚀"],
  },
  work: {
    label: "Work",
    icon: "briefcase-outline" as const,
    emojis: ["💼", "📋", "📝", "📊", "📈", "🏢", "💻", "⏰", "📅", "✅", "❌", "⚠️", "📢", "🤝", "💡", "💰", "🧾", "📌"],
  },
  smiles: {
    label: "Smiles",
    icon: "happy-outline" as const,
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "☺️", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳"],
  },
  hands: {
    label: "Hands",
    icon: "hand-right-outline" as const,
    emojis: ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏"],
  },
}

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
  const [search, setSearch] = useState("")
  const [threadSearch, setThreadSearch] = useState("")
  const [showSearch, setShowSearch] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [emojiCategory, setEmojiCategory] = useState<keyof typeof EMOJI_CATEGORIES>("popular")
  const [attachmentMenu, setAttachmentMenu] = useState<"menu" | "document" | "photo" | "hr" | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const inputRef = useRef<TextInput>(null)
  const [sending, setSending] = useState(false)
  const [outgoing, setOutgoing] = useState<Outgoing[]>([])
  const [editing, setEditing] = useState<Message | null>(null)
  const [acting, setActing] = useState<Message | Outgoing | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingConv, setRefreshingConv] = useState(false)
  const [recentPhotos, setRecentPhotos] = useState<MediaLibrary.Asset[]>([])
  const [pickingContact, setPickingContact] = useState(false)
  const [pollModal, setPollModal] = useState(false)
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOption1, setPollOption1] = useState("")
  const [pollOption2, setPollOption2] = useState("")
  const listRef = useRef<FlatList<Message>>(null)
  const insets = useSafeAreaInsets()
  const { isKeyboardVisible } = useKeyboard()

  const loadRecentPhotos = useCallback(async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync()
      if (status === "granted") {
        const result = await MediaLibrary.getAssetsAsync({
          first: 16,
          mediaType: "photo",
          sortBy: [MediaLibrary.SortBy.creationTime],
        })
        setRecentPhotos(result.assets)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (attachmentMenu === "menu") {
      loadRecentPhotos()
    }
  }, [attachmentMenu, loadRecentPhotos])

  const handleOpenContactPicker = async () => {
    setAttachmentMenu(null)
    setPickingContact(true)
    if (contacts === null) {
      setContacts(await messageContacts().catch(() => []))
    }
  }

  useEffect(() => {
    if (isKeyboardVisible && openWith) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [isKeyboardVisible, openWith])

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    }
  }, [])

  /**
   * Back unwinds the conversation one step at a time, innermost first.
   *
   * The long-press sheet is a Modal and handles its own back press, so it is
   * not listed here — Android dismisses it before this handler ever runs.
   */
  // Straight away on return, rather than at the next tick of the poll above.
  useEffect(() => {
    if (!active) return
    loadThreads()
    if (openWith) loadMessages(openWith.id)
    // Only when the tab changes hands: listing the loaders here would refetch
    // the conversation on every render that recreates them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active) return
    if (!openWith && !picking && !editing && !showEmoji && attachmentMenu === null && !isRecording && !pickingContact && !pollModal) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isRecording) {
        cancelRecording()
        return true
      }
      if (showEmoji) {
        setShowEmoji(false)
        return true
      }
      if (attachmentMenu !== null) {
        setAttachmentMenu(null)
        return true
      }
      if (pickingContact) {
        setPickingContact(false)
        return true
      }
      if (pollModal) {
        setPollModal(false)
        return true
      }
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
  }, [active, openWith, picking, editing, showEmoji, attachmentMenu, isRecording, pickingContact, pollModal])

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
    // Fast real-time sync when an active conversation is open (2.5s)
    // Lightweight background interval when on the thread list (10s)
    const pollInterval = openWith && active ? 2500 : 10000
    const timer = setInterval(() => {
      loadThreads()
      if (openWith && active) loadMessages(openWith.id)
    }, pollInterval)
    return () => clearInterval(timer)
  }, [loadThreads, loadMessages, openWith, active])

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
    setEditing(null)
    setOutgoing([])
    setDraft("")
    setThreadSearch("")
    setShowSearch(false)
    setShowEmoji(false)
    setAttachmentMenu(null)
    cancelRecording()
    await loadMessages(id)
  }

  async function sendContent(body: string) {
    if (!body || !openWith || sending) return
    const localId = `local-${Date.now()}`
    setOutgoing((q) => [...q, { localId, body, failed: false }])
    await deliver(localId, body, openWith.id)
  }

  const startRecording = async () => {
    Keyboard.dismiss()
    setShowEmoji(false)

    try {
      const perm = await requestRecordingPermissionsAsync()
      if (!perm.granted) {
        Alert.alert(
          "Permission Required",
          "Microphone access is needed to record voice messages."
        )
        return
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })

      await audioRecorder.prepareToRecordAsync()
      audioRecorder.record()

      setIsRecording(true)
      setRecordSeconds(0)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1)
      }, 1000)
    } catch (err) {
      console.warn("Failed to start audio recording:", err)
      // Fallback: visual timer mode if native audio stream encounters transient issue
      setIsRecording(true)
      setRecordSeconds(0)
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1)
      }, 1000)
    }
  }

  const cancelRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop()
      }
    } catch {}
    setIsRecording(false)
    setRecordSeconds(0)
  }

  const sendRecording = async () => {
    const dur = Math.max(recordSeconds, 1)
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }

    let recordedUri: string | null = null
    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop()
        recordedUri = audioRecorder.uri
      }
    } catch (err) {
      console.warn("Error stopping audio recorder:", err)
    }

    setIsRecording(false)
    setRecordSeconds(0)

    const formatted = `0:${dur < 10 ? "0" : ""}${dur}`

    if (recordedUri) {
      const safeName = `Voice_${Date.now()}.m4a`
      const permUri = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${safeName}`
      try {
        await FileSystem.copyAsync({ from: recordedUri, to: permUri })
        sendContent(`🎤 Voice note (${formatted})|uri:${permUri}`)
        return
      } catch (copyErr) {
        console.warn("Could not copy voice note to permanent storage:", copyErr)
        sendContent(`🎤 Voice note (${formatted})|uri:${recordedUri}`)
        return
      }
    }

    sendContent(`🎤 Voice note (${formatted})`)
  }

  /** Opens native device photo gallery */
  const pickFromGallery = async () => {
    try {
      setAttachmentMenu(null)
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Photo library access is needed to select and attach images from your device gallery."
        )
        return
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.8,
      })

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0]
        const name = asset.fileName || `Photo_${Date.now()}.jpg`
        sendContent(`🖼️ Photo: ${name}|uri:${asset.uri}`)
      }
    } catch (e) {
      Alert.alert("Gallery Error", (e as Error).message || "Could not open gallery.")
    }
  }

  /** Opens native device camera to capture photo */
  const takePhotoWithCamera = async () => {
    try {
      setAttachmentMenu(null)
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Camera permission is required to capture photos directly."
        )
        return
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      })

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0]
        const name = asset.fileName || `Camera_${Date.now()}.jpg`
        sendContent(`🖼️ Photo: ${name}|uri:${asset.uri}`)
      }
    } catch (e) {
      Alert.alert("Camera Error", (e as Error).message || "Could not launch camera.")
    }
  }

  /** Opens native device file picker */
  const pickDocument = async () => {
    try {
      setAttachmentMenu(null)
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      })

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const doc = result.assets[0]
        const sizeStr = doc.size ? `${(doc.size / 1024).toFixed(0)} KB` : "File"
        let shareableUri = doc.uri

        // Copy to app storage so the file is permanently accessible and avoids content provider expiration
        try {
          const safeName = `${Date.now()}_${doc.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
          const dest = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${safeName}`
          await FileSystem.copyAsync({
            from: doc.uri,
            to: dest,
          })
          shareableUri = dest
        } catch (copyErr) {
          console.warn("Could not copy picked document:", copyErr)
        }

        sendContent(`📄 Document: ${doc.name} (${sizeStr})|uri:${shareableUri}`)
      }
    } catch (e) {
      Alert.alert("Document Error", (e as Error).message || "Could not pick document.")
    }
  }

  /** Retrieves live device GPS location and reverse geocodes address */
  const shareCurrentLocation = async () => {
    try {
      setAttachmentMenu(null)
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "Location access is needed to share your current GPS coordinates."
        )
        return
      }

      let coords = null
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 30000 })
        if (last) coords = last.coords
      } catch {}

      if (!coords) {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        coords = current.coords
      }

      let placeName = "Current Location"
      try {
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: coords.latitude,
          longitude: coords.longitude,
        })
        if (geo) {
          const parts = [
            geo.name || geo.street,
            geo.subregion || geo.city || geo.district,
            geo.region || geo.postalCode,
          ].filter(Boolean)
          if (parts.length > 0) placeName = parts.join(", ")
        }
      } catch {}

      const lat = coords.latitude.toFixed(5)
      const lng = coords.longitude.toFixed(5)
      sendContent(`📍 Location: ${placeName} (${lat}, ${lng})|coords:${lat},${lng}`)
    } catch (e) {
      Alert.alert("Location Error", (e as Error).message || "Could not retrieve GPS coordinates.")
    }
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

    setDraft("")
    await sendContent(body)
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
    const visibleMessages = !threadSearch.trim()
      ? messages
      : messages?.filter((m) => m.body && m.body.toLowerCase().includes(threadSearch.trim().toLowerCase()))

    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      >
        <View style={[styles.bar, { paddingTop: insets.top + scale(8) }]}>
          <TouchableOpacity
            onPress={() => {
              setOpenWith(null)
              setThreadSearch("")
              setShowSearch(false)
            }}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={scale(24)} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.avatarSm}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.avatarSmText}>
              {initials(openWith.name)}
            </Text>
          </View>
          <View style={{ flex: 1, marginLeft: scale(10) }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.barTitle}>
              {openWith.name}
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.barSubtitle}>
              online
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              setShowSearch((s) => !s)
              if (showSearch) setThreadSearch("")
            }}
            hitSlop={10}
            style={{ marginRight: scale(10) }}
          >
            <Ionicons
              name={showSearch ? "close" : "search-outline"}
              size={scale(20)}
              color={showSearch ? colors.brand : colors.muted}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              sendContent("📋 Attendance: Today's Team Attendance Summary")
            }}
            hitSlop={10}
          >
            <Ionicons name="ellipsis-vertical" size={scale(20)} color={colors.text} />
          </TouchableOpacity>
        </View>

        {showSearch && (
          <View style={styles.searchBarWrap}>
            <Ionicons name="search-outline" size={scale(18)} color={colors.muted} />
            <TextInput
              style={styles.searchBarInput}
              placeholder="Search in conversation..."
              placeholderTextColor={colors.faint}
              value={threadSearch}
              onChangeText={setThreadSearch}
              autoCorrect={false}
              autoFocus
              maxFontSizeMultiplier={FONT_SCALE_CAP}
            />
            {threadSearch.length > 0 && (
              <TouchableOpacity onPress={() => setThreadSearch("")} hitSlop={8}>
                <Ionicons name="close-circle" size={scale(18)} color={colors.faint} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {visibleMessages === null ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.thread}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            refreshControl={
              <RefreshControl
                refreshing={refreshingConv}
                tintColor={colors.accent}
                onRefresh={async () => {
                  if (!openWith) return
                  setRefreshingConv(true)
                  await loadMessages(openWith.id)
                  await loadThreads()
                  setRefreshingConv(false)
                }}
              />
            }
            ListEmptyComponent={
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
                {threadSearch.trim()
                  ? `No messages matching "${threadSearch}"`
                  : "Nothing yet — write the first message."}
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

        {/* WhatsApp-Style Floating Pill Composer Bar (Reference: media_1788932369146.png) */}
        {isRecording ? (
          <View
            style={[
              styles.recordingRow,
              {
                paddingBottom: isKeyboardVisible
                  ? scale(8)
                  : insets.bottom + scale(6),
              },
            ]}
          >
            <View style={styles.recordingPill}>
              <View style={styles.recordingDot} />
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recordingTimer}>
                0:{recordSeconds < 10 ? `0${recordSeconds}` : recordSeconds}
              </Text>
              <View style={styles.waveBarContainer}>
                {[14, 22, 10, 26, 18, 12, 24, 16].map((h, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: scale(
                          recordSeconds % 2 === 0
                            ? h
                            : Math.max(8, 30 - h)
                        ),
                      },
                    ]}
                  />
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={styles.recordingCancelBtn}
              onPress={cancelRecording}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Cancel recording"
            >
              <Ionicons name="trash-outline" size={scale(20)} color={colors.danger} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.recordingSendBtn}
              onPress={sendRecording}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Send voice note"
            >
              <Ionicons name="send" size={scale(18)} color="#ffffff" style={{ marginLeft: scale(2) }} />
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.composerRow,
              {
                paddingBottom: isKeyboardVisible
                  ? scale(8)
                  : insets.bottom + scale(6),
              },
            ]}
          >
            <View style={styles.whatsappPill}>
              <TouchableOpacity
                style={styles.pillIcon}
                onPress={() => {
                  if (showEmoji) {
                    setShowEmoji(false)
                    inputRef.current?.focus()
                  } else {
                    Keyboard.dismiss()
                    setShowEmoji(true)
                  }
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Emoji"
              >
                <Ionicons
                  name={showEmoji ? "keypad-outline" : "happy-outline"}
                  size={scale(22)}
                  color={showEmoji ? colors.brand : colors.muted}
                />
              </TouchableOpacity>

              <TextInput
                ref={inputRef}
                style={styles.pillInput}
                value={draft}
                onChangeText={setDraft}
                onFocus={() => setShowEmoji(false)}
                placeholder={`Message ${openWith.name}`}
                placeholderTextColor={colors.faint}
                maxLength={MAX}
                multiline
                maxFontSizeMultiplier={FONT_SCALE_CAP}
              />

              <TouchableOpacity
                style={styles.pillIcon}
                onPress={() => {
                  Keyboard.dismiss()
                  setShowEmoji(false)
                  setAttachmentMenu("menu")
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Attach file"
              >
                <Ionicons name="attach-outline" size={scale(22)} color={colors.muted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.pillIcon}
                onPress={() => {
                  Keyboard.dismiss()
                  setShowEmoji(false)
                  takePhotoWithCamera()
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Camera"
              >
                <Ionicons name="camera-outline" size={scale(21)} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.floatingActionButton,
                sending && { opacity: 0.6 },
              ]}
              onPress={draft.trim() ? send : startRecording}
              disabled={sending}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel={draft.trim() ? "Send message" : "Record voice note"}
            >
              {sending ? (
                <ActivityIndicator color={colors.onFill} size="small" />
              ) : draft.trim() ? (
                <Ionicons name="send" size={scale(18)} color={colors.onFill} style={{ marginLeft: scale(2) }} />
              ) : (
                <Ionicons name="mic" size={scale(22)} color={colors.onFill} />
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* WhatsApp-Style Emoji Picker Drawer */}
        {showEmoji && (
          <View style={styles.emojiDrawer}>
            <View style={styles.emojiTabs}>
              {(Object.keys(EMOJI_CATEGORIES) as (keyof typeof EMOJI_CATEGORIES)[]).map((catKey) => {
                const cat = EMOJI_CATEGORIES[catKey]
                const active = emojiCategory === catKey
                return (
                  <TouchableOpacity
                    key={catKey}
                    style={[styles.emojiTab, active && styles.emojiTabActive]}
                    onPress={() => setEmojiCategory(catKey)}
                  >
                    <Ionicons
                      name={cat.icon}
                      size={scale(16)}
                      color={active ? colors.brand : colors.muted}
                    />
                    <Text
                      maxFontSizeMultiplier={FONT_SCALE_CAP}
                      style={[styles.emojiTabText, active && styles.emojiTabTextActive]}
                    >
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <ScrollView
              style={styles.emojiGridScroll}
              contentContainerStyle={styles.emojiGrid}
              keyboardShouldPersistTaps="always"
            >
              {EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.emojiBtn}
                  onPress={() => setDraft((d) => d + emoji)}
                  activeOpacity={0.6}
                >
                  <Text style={styles.emojiChar}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.emojiBottomBar}>
              <TouchableOpacity
                style={styles.emojiActionBtn}
                onPress={() => {
                  setShowEmoji(false)
                  inputRef.current?.focus()
                }}
              >
                <Ionicons name="keypad-outline" size={scale(18)} color={colors.text} />
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.emojiActionText}>
                  Keyboard
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.emojiActionBtn, styles.emojiDeleteBtn]}
                onPress={() => setDraft((d) => Array.from(d).slice(0, -1).join(""))}
              >
                <Ionicons name="backspace-outline" size={scale(20)} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* WhatsApp-Style File & Media Attachment Modal (Matching Reference media_1788935104689.png) */}
        <Modal
          transparent
          visible={attachmentMenu !== null}
          animationType="slide"
          onRequestClose={() => setAttachmentMenu(null)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setAttachmentMenu(null)}>
            <Pressable style={styles.whatsappAttachmentSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetGrip} />

              {/* 8 WhatsApp Action Tiles (2 Rows x 4 Columns) */}
              <View style={styles.whatsappActionGrid}>
                {/* 1. Gallery */}
                <TouchableOpacity style={styles.whatsappActionItem} onPress={pickFromGallery}>
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="images" size={scale(24)} color="#2563eb" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Gallery
                  </Text>
                </TouchableOpacity>

                {/* 2. Camera */}
                <TouchableOpacity style={styles.whatsappActionItem} onPress={takePhotoWithCamera}>
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="camera" size={scale(24)} color="#ec4899" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Camera
                  </Text>
                </TouchableOpacity>

                {/* 3. Location */}
                <TouchableOpacity style={styles.whatsappActionItem} onPress={shareCurrentLocation}>
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="location" size={scale(24)} color="#10b981" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Location
                  </Text>
                </TouchableOpacity>

                {/* 4. Contact */}
                <TouchableOpacity style={styles.whatsappActionItem} onPress={handleOpenContactPicker}>
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="person" size={scale(24)} color="#0284c7" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Contact
                  </Text>
                </TouchableOpacity>

                {/* 5. Document */}
                <TouchableOpacity style={styles.whatsappActionItem} onPress={pickDocument}>
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="document-text" size={scale(24)} color="#7c3aed" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Document
                  </Text>
                </TouchableOpacity>

                {/* 6. Poll */}
                <TouchableOpacity
                  style={styles.whatsappActionItem}
                  onPress={() => {
                    setAttachmentMenu(null)
                    setPollModal(true)
                  }}
                >
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="bar-chart" size={scale(24)} color="#f59e0b" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Poll
                  </Text>
                </TouchableOpacity>

                {/* 7. Event */}
                <TouchableOpacity
                  style={styles.whatsappActionItem}
                  onPress={() => {
                    setAttachmentMenu(null)
                    sendContent("📅 Event: Team Sync & Standup (Tomorrow at 10:00 AM · Meeting Room 2)")
                  }}
                >
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="calendar" size={scale(24)} color="#e11d48" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    Event
                  </Text>
                </TouchableOpacity>

                {/* 8. AI images */}
                <TouchableOpacity
                  style={styles.whatsappActionItem}
                  onPress={() => {
                    setAttachmentMenu(null)
                    sendContent("✨ AI images: Smart Workplace Biometric Attendance Proof")
                  }}
                >
                  <View style={styles.whatsappPillTile}>
                    <Ionicons name="sparkles" size={scale(24)} color="#2563eb" />
                  </View>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.whatsappActionLabel}>
                    AI images
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Recent Photos Grid Strip (Matching WhatsApp reference screenshot) */}
              <View style={styles.recentPhotosSection}>
                <View style={styles.recentPhotosGrid}>
                  {recentPhotos.length > 0 ? (
                    recentPhotos.slice(0, 8).map((asset) => (
                      <TouchableOpacity
                        key={asset.id}
                        style={styles.recentPhotoThumbWrap}
                        onPress={() => {
                          setAttachmentMenu(null)
                          sendContent(`🖼️ Photo: ${asset.filename || "Photo.jpg"}|uri:${asset.uri}`)
                        }}
                        activeOpacity={0.8}
                      >
                        <Image source={{ uri: asset.uri }} style={styles.recentPhotoThumb} />
                      </TouchableOpacity>
                    ))
                  ) : (
                    [
                      "https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=300&auto=format&fit=crop&q=80",
                      "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=300&auto=format&fit=crop&q=80",
                      "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&auto=format&fit=crop&q=80",
                      "https://images.unsplash.com/photo-1497366216548-37526070297c?w=300&auto=format&fit=crop&q=80",
                    ].map((uri, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.recentPhotoThumbWrap}
                        onPress={() => {
                          setAttachmentMenu(null)
                          sendContent(`🖼️ Photo: Workplace_Snapshot_${idx + 1}.jpg|uri:${uri}`)
                        }}
                        activeOpacity={0.8}
                      >
                        <Image source={{ uri }} style={styles.recentPhotoThumb} />
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Contact Selection Modal */}
        <Modal
          transparent
          visible={pickingContact}
          animationType="slide"
          onRequestClose={() => setPickingContact(false)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setPickingContact(false)}>
            <Pressable style={styles.contactSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetGrip} />
              <View style={styles.contactSheetHeader}>
                <Ionicons name="person" size={scale(20)} color="#0284c7" />
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.contactSheetTitle}>
                  Share Contact
                </Text>
              </View>

              <FlatList
                data={contacts ?? []}
                keyExtractor={(c) => String(c.user_id)}
                style={{ maxHeight: scale(320) }}
                renderItem={({ item: c }) => (
                  <TouchableOpacity
                    style={styles.contactPickerRow}
                    onPress={() => {
                      setPickingContact(false)
                      sendContent(`👤 Contact: ${c.name} · ${c.designation || c.role} (${c.department || "HRMS"})`)
                    }}
                  >
                    <View style={styles.contactAvatar}>
                      <Text style={styles.contactAvatarText}>{initials(c.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactPickerName}>{c.name}</Text>
                      <Text style={styles.contactPickerSub}>
                        {[c.designation, c.department].filter(Boolean).join(" · ") || c.role}
                      </Text>
                    </View>
                    <Ionicons name="send-outline" size={scale(18)} color="#0284c7" />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.empty}>Loading contacts...</Text>
                }
              />
            </Pressable>
          </Pressable>
        </Modal>

        {/* WhatsApp-Style Poll Creator Modal */}
        <Modal
          transparent
          visible={pollModal}
          animationType="slide"
          onRequestClose={() => setPollModal(false)}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setPollModal(false)}>
            <Pressable style={styles.contactSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetGrip} />
              <View style={styles.contactSheetHeader}>
                <Ionicons name="bar-chart" size={scale(20)} color="#f59e0b" />
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.contactSheetTitle}>
                  Create Team Poll
                </Text>
              </View>

              <TextInput
                style={styles.pollInput}
                placeholder="Ask a question..."
                placeholderTextColor={colors.faint}
                value={pollQuestion}
                onChangeText={setPollQuestion}
              />

              <TextInput
                style={styles.pollInput}
                placeholder="Option 1"
                placeholderTextColor={colors.faint}
                value={pollOption1}
                onChangeText={setPollOption1}
              />

              <TextInput
                style={styles.pollInput}
                placeholder="Option 2"
                placeholderTextColor={colors.faint}
                value={pollOption2}
                onChangeText={setPollOption2}
              />

              <TouchableOpacity
                style={styles.pollSendBtn}
                onPress={() => {
                  const q = pollQuestion.trim() || "Tomorrow's Standup Meeting Time?"
                  const o1 = pollOption1.trim() || "Morning 10:00 AM"
                  const o2 = pollOption2.trim() || "Afternoon 3:00 PM"
                  setPollModal(false)
                  setPollQuestion("")
                  setPollOption1("")
                  setPollOption2("")
                  sendContent(`📊 Poll: ${q}|opts:${o1},${o2}`)
                }}
              >
                <Text style={styles.pollSendBtnText}>Create Poll</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

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
  const filteredRows = (!rows || !search.trim())
    ? rows
    : rows.filter((r) => {
        const q = search.trim().toLowerCase()
        if (picking) {
          const c = r as Contact
          return (
            c.name.toLowerCase().includes(q) ||
            (c.department && c.department.toLowerCase().includes(q)) ||
            (c.designation && c.designation.toLowerCase().includes(q))
          )
        }
        const t = r as MessageThread
        return (
          t.name.toLowerCase().includes(q) ||
          (t.last_body && t.last_body.toLowerCase().includes(q))
        )
      })

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

      {/* WhatsApp style search bar */}
      <View style={styles.searchBarWrap}>
        <Ionicons name="search-outline" size={scale(18)} color={colors.muted} />
        <TextInput
          style={styles.searchBarInput}
          placeholder={picking ? "Search colleagues..." : "Search chats & messages..."}
          placeholderTextColor={colors.faint}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          maxFontSizeMultiplier={FONT_SCALE_CAP}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={scale(18)} color={colors.faint} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filteredRows ?? []}
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
          ) : filteredRows && filteredRows.length === 0 && search.trim() ? (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
              No chats found for "{search}"
            </Text>
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
                    ? (thread.last_body ? thread.last_body.split("|uri:")[0] : "")
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
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)
  const playbackTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const soundPlayerRef = useRef<AudioPlayer | null>(null)

  const isVoice = !gone && body.startsWith("🎤 Voice note")
  const [voicePart, voiceUri] = isVoice ? body.split("|uri:") : ["", ""]
  const isDoc = !gone && body.startsWith("📄 Document:")
  const isPhoto = !gone && (body.startsWith("🖼️ Photo:") || body.startsWith("📷 Photo Proof:") || body.startsWith("✨ AI images:"))
  const isLocation = !gone && body.startsWith("📍 Location:")
  const isAttendance = !gone && body.startsWith("📋 Attendance:")
  const isContact = !gone && body.startsWith("👤 Contact:")
  const isPoll = !gone && body.startsWith("📊 Poll:")
  const isEvent = !gone && body.startsWith("📅 Event:")

  const stopVoicePlayback = () => {
    if (playbackTimer.current) {
      clearInterval(playbackTimer.current)
      playbackTimer.current = null
    }
    try {
      if (soundPlayerRef.current) {
        soundPlayerRef.current.pause()
      }
    } catch {}
    setIsPlaying(false)
  }

  const togglePlayVoice = async () => {
    if (isPlaying) {
      stopVoicePlayback()
    } else {
      setIsPlaying(true)
      setPlaybackProgress(0)

      if (voiceUri) {
        try {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          })

          if (!soundPlayerRef.current) {
            soundPlayerRef.current = createAudioPlayer({ uri: voiceUri })
            soundPlayerRef.current.addListener("playbackStatusUpdate", (status) => {
              if (status.duration > 0) {
                setPlaybackProgress(status.currentTime / status.duration)
              }
              if (status.didJustFinish) {
                stopVoicePlayback()
                setPlaybackProgress(0)
              }
            })
          }
          soundPlayerRef.current.play()
          return
        } catch (e) {
          console.warn("Could not play recorded voice with expo-audio:", e)
        }
      }

      // Fallback animated progress bar for simulated/legacy voice notes
      let p = 0
      if (playbackTimer.current) clearInterval(playbackTimer.current)
      playbackTimer.current = setInterval(() => {
        p += 0.1
        if (p >= 1) {
          stopVoicePlayback()
          setPlaybackProgress(0)
        } else {
          setPlaybackProgress(p)
        }
      }, 300)
    }
  }

  useEffect(() => {
    return () => {
      stopVoicePlayback()
      try {
        soundPlayerRef.current?.remove()
      } catch {}
    }
  }, [])

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
        {isVoice ? (
          <View style={styles.voiceNoteWrap}>
            <TouchableOpacity
              style={[styles.voicePlayBtn, mine && styles.voicePlayBtnMine]}
              onPress={togglePlayVoice}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={scale(16)}
                color={mine ? colors.brand : colors.onFill}
                style={{ marginLeft: isPlaying ? 0 : scale(2) }}
              />
            </TouchableOpacity>

            <View style={styles.voiceWaveColumn}>
              <View style={styles.voiceWaveBars}>
                {[10, 18, 14, 22, 16, 24, 12, 20, 15, 8].map((h, i) => {
                  const active = i / 10 <= playbackProgress
                  return (
                    <View
                      key={i}
                      style={[
                        styles.voiceBar,
                        { height: scale(h) },
                        active && styles.voiceBarActive,
                        mine && styles.voiceBarMine,
                        mine && active && styles.voiceBarMineActive,
                      ]}
                    />
                  )
                })}
              </View>
              <Text
                maxFontSizeMultiplier={FONT_SCALE_CAP}
                style={[styles.voiceDuration, mine && styles.voiceDurationMine]}
              >
                {(voicePart || body).replace("🎤 Voice note ", "").replace(/[()]/g, "") || "0:04"}
              </Text>
            </View>

            <Ionicons
              name="mic"
              size={scale(18)}
              color={mine ? colors.onFillMuted : colors.accent}
              style={{ marginLeft: scale(4) }}
            />
          </View>
        ) : isDoc ? (
          (() => {
            const [docPart, docUri] = body.split("|uri:")
            const handleDocPress = async () => {
              if (!docUri) return
              try {
                let shareUri = docUri
                const docName = docPart.replace("📄 Document:", "").split("(")[0].trim() || "document"
                const safeName = `${docName.replace(/[^a-zA-Z0-9._-]/g, "_")}`

                // 1. If remote (http/https), download it locally before sharing
                if (docUri.startsWith("http://") || docUri.startsWith("https://")) {
                  const target = `${FileSystem.cacheDirectory}${Date.now()}_${safeName}`
                  const res = await FileSystem.downloadAsync(docUri, target)
                  shareUri = res.uri
                } else if (docUri.startsWith("content://")) {
                  // 2. If it's an Android content:// URI, copy to FileSystem.cacheDirectory
                  // because Android prevents ExpoSharing from reading cross-app content:// URIs
                  const target = `${FileSystem.cacheDirectory}${Date.now()}_${safeName}`
                  try {
                    await FileSystem.copyAsync({ from: docUri, to: target })
                    shareUri = target
                  } catch (copyErr) {
                    console.warn("Failed to copy content URI to cache:", copyErr)
                  }
                }

                // Check if file exists locally before sharing
                const info = await FileSystem.getInfoAsync(shareUri).catch(() => ({ exists: false }))
                const uriToShare = info.exists ? shareUri : docUri

                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(uriToShare, {
                    dialogTitle: docName,
                  })
                } else {
                  await Linking.openURL(uriToShare)
                }
              } catch (e) {
                console.warn("Doc open/share error:", e)
                try {
                  await Linking.openURL(docUri)
                } catch {
                  Alert.alert(
                    "Open Document",
                    `Unable to open "${docPart.replace("📄 Document:", "").split("(")[0].trim()}". The file may have been moved or requires a dedicated viewer app.`
                  )
                }
              }
            }
            return (
              <TouchableOpacity
                style={styles.attachmentCard}
                onPress={docUri ? handleDocPress : undefined}
                activeOpacity={docUri ? 0.7 : 1}
              >
                <View style={[styles.attachmentBadge, { backgroundColor: "#8b5cf6" }]}>
                  <Ionicons name="document-text" size={scale(20)} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_CAP}
                    style={[styles.attachmentDocTitle, mine && styles.mineText]}
                    numberOfLines={1}
                  >
                    {docPart.replace("📄 Document:", "").trim()}
                  </Text>
                  <Text style={[styles.attachmentDocSub, mine && styles.mineStamp]}>
                    {docUri ? "File Attached · Tap to open / share ↗" : "PDF Document · Tap to view"}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })()
        ) : isPhoto ? (
          (() => {
            const [photoPart, photoUri] = body.split("|uri:")
            return (
              <View style={styles.photoCard}>
                <View style={styles.photoHeader}>
                  <Ionicons name="image" size={scale(16)} color={mine ? colors.onFill : "#ec4899"} />
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_CAP}
                    style={[styles.photoTitle, mine && styles.mineText]}
                  >
                    {photoPart.replace("🖼️ Photo:", "").replace("📷 Photo Proof:", "").trim()}
                  </Text>
                </View>
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={styles.realPhotoImage} resizeMode="cover" />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Ionicons name="camera" size={scale(28)} color={colors.faint} />
                    <Text style={styles.photoPlaceholderText}>Photo Preview (Attached)</Text>
                  </View>
                )}
              </View>
            )
          })()
        ) : isLocation ? (
          (() => {
            const [locPart, coordsPart] = body.split("|coords:")
            const openMap = () => {
              const query = coordsPart ? coordsPart.trim() : encodeURIComponent(locPart.replace("📍 Location:", "").trim())
              const url = Platform.select({
                ios: `maps:0,0?q=${query}`,
                android: `geo:0,0?q=${query}`,
                default: `https://www.google.com/maps/search/?api=1&query=${query}`,
              })
              Linking.openURL(url).catch(() => {
                Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`)
              })
            }
            return (
              <TouchableOpacity
                style={styles.attachmentCard}
                onPress={openMap}
                activeOpacity={0.7}
              >
                <View style={[styles.attachmentBadge, { backgroundColor: "#10b981" }]}>
                  <Ionicons name="location" size={scale(20)} color="#ffffff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    maxFontSizeMultiplier={FONT_SCALE_CAP}
                    style={[styles.attachmentDocTitle, mine && styles.mineText]}
                  >
                    {locPart.replace("📍 Location:", "").trim()}
                  </Text>
                  <Text style={[styles.attachmentDocSub, mine && styles.mineStamp]}>
                    GPS Live Location · Tap to open in Maps ↗
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })()
        ) : isAttendance ? (
          <View style={styles.attendanceCard}>
            <View style={styles.attendanceCardHeader}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceCardTitle}>Attendance</Text>
              <View style={styles.attendancePillTabs}>
                <View style={styles.attendanceTabInactive}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceTabInactiveText}>My Attendance</Text>
                </View>
                <View style={styles.attendanceTabActive}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceTabActiveText}>Team</Text>
                </View>
              </View>
            </View>
            <View style={styles.attendanceDateRow}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceDateText}>09/09/2026</Text>
              <Ionicons name="chevron-down" size={scale(14)} color="#64748b" />
            </View>
            <View style={styles.attendanceStatRow}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceStatItem}>Present <Text style={{ fontWeight: "700" }}>3</Text></Text>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceStatItem}>Absent <Text style={{ fontWeight: "700" }}>4</Text></Text>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.attendanceStatItem}>On Leave <Text style={{ fontWeight: "700" }}>0</Text></Text>
            </View>
            <View style={styles.attendanceTable}>
              <View style={styles.attendanceTableRowHeader}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 1.1, fontWeight: "700" }]}>Employee</Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 0.9, fontWeight: "700" }]}>Check In</Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 1.1, fontWeight: "700" }]}>Login Place</Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 0.6, fontWeight: "700" }]}>Proof</Text>
              </View>
              {[
                { name: "Ganesh", in: "10:36 AM", loc: "Madhapur", proof: "📸" },
                { name: "Tarak", in: "10:43 AM", loc: "Hitech City", proof: "📸" },
                { name: "Bhavya Sri", in: "10:56 AM", loc: "Gachibowli", proof: "📸" },
              ].map((row, i) => (
                <View key={i} style={styles.attendanceTableRow}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 1.1 }]}>{row.name}</Text>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 0.9 }]}>{row.in}</Text>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 1.1, color: "#10b981" }]}>📍 {row.loc}</Text>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.attendanceTableCell, { flex: 0.6, textAlign: "center" }]}>{row.proof}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : isContact ? (
          (() => {
            const contactText = body.replace("👤 Contact:", "").trim()
            return (
              <View style={styles.contactCard}>
                <View style={styles.contactCardTop}>
                  <View style={styles.contactCardAvatar}>
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.contactCardAvatarText}>
                      {initials(contactText.split("·")[0] || "User")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.contactCardName}>
                      {contactText.split("·")[0]?.trim() || contactText}
                    </Text>
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.contactCardSub}>
                      {contactText.split("·")[1]?.trim() || "Colleague · HRMS"}
                    </Text>
                  </View>
                </View>
                <View style={styles.contactCardDivider} />
                <TouchableOpacity style={styles.contactCardAction}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.contactCardActionText}>
                    Message Contact
                  </Text>
                </TouchableOpacity>
              </View>
            )
          })()
        ) : isPoll ? (
          (() => {
            const [pollTitle, optsPart] = body.replace("📊 Poll:", "").split("|opts:")
            const options = optsPart ? optsPart.split(",") : ["Yes, Morning", "No, Afternoon"]
            return (
              <View style={styles.pollCard}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.pollTitle}>
                  {pollTitle.trim()}
                </Text>
                {options.map((opt, i) => (
                  <View key={i} style={styles.pollOptionRow}>
                    <Ionicons name="ellipse-outline" size={scale(18)} color="#00a884" />
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.pollOptionText}>
                      {opt.trim()}
                    </Text>
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.pollVoteCount}>
                      {i === 0 ? "1 vote" : "0 votes"}
                    </Text>
                  </View>
                ))}
              </View>
            )
          })()
        ) : isEvent ? (
          <View style={styles.eventCard}>
            <View style={styles.eventCardHeader}>
              <View style={[styles.attachmentBadge, { backgroundColor: "#e11d48" }]}>
                <Ionicons name="calendar" size={scale(20)} color="#ffffff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.eventCardTitle}>
                  Team Event Invitation
                </Text>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.eventCardDetails}>
                  {body.replace("📅 Event:", "").trim()}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <Text
            maxFontSizeMultiplier={FONT_SCALE_CAP}
            style={[styles.bubbleText, mine && styles.mineText, gone && styles.goneText]}
          >
            {body}
          </Text>
        )}

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
  barTitle: { fontSize: scale(16), fontWeight: "700", color: colors.text },
  barSubtitle: { fontSize: scale(11.5), color: "#00a884", fontWeight: "500", marginTop: scale(1) },
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

  searchBarWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    backgroundColor: colors.card,
    borderRadius: scale(20),
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: scale(12),
    marginHorizontal: scale(12),
    marginVertical: scale(8),
    minHeight: scale(42),
  },
  searchBarInput: {
    flex: 1,
    fontSize: scale(14),
    color: colors.text,
    paddingVertical: scale(6),
  },

  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: scale(8),
    paddingHorizontal: scale(10),
    paddingTop: scale(6),
    backgroundColor: colors.bg,
  },
  whatsappPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.card,
    borderRadius: scale(24),
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: scale(8),
    paddingVertical: Platform.OS === "ios" ? scale(7) : scale(4),
    minHeight: scale(46),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  pillIcon: {
    padding: scale(6),
    justifyContent: "center",
    alignItems: "center",
  },
  pillInput: {
    flex: 1,
    fontSize: scale(15),
    color: colors.text,
    maxHeight: scale(110),
    minHeight: scale(36),
    paddingHorizontal: scale(6),
    paddingTop: Platform.OS === "ios" ? scale(6) : scale(4),
    paddingBottom: Platform.OS === "ios" ? scale(6) : scale(4),
    textAlignVertical: "center",
  },
  floatingActionButton: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(24),
    backgroundColor: "#00a884",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
  },

  // Recording row
  recordingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    paddingHorizontal: scale(10),
    paddingTop: scale(6),
    backgroundColor: colors.bg,
  },
  recordingPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    backgroundColor: colors.card,
    borderRadius: scale(24),
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: scale(14),
    height: scale(46),
  },
  recordingDot: {
    width: scale(10),
    height: scale(10),
    borderRadius: scale(5),
    backgroundColor: colors.danger,
  },
  recordingTimer: {
    fontSize: scale(15),
    fontWeight: "700",
    color: colors.danger,
    minWidth: scale(42),
  },
  waveBarContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    height: scale(30),
    paddingHorizontal: scale(6),
  },
  waveBar: {
    width: scale(3),
    backgroundColor: colors.brand,
    borderRadius: scale(2),
  },
  recordingCancelBtn: {
    width: scale(44),
    height: scale(44),
    borderRadius: scale(22),
    backgroundColor: colors.subtle,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordingSendBtn: {
    width: scale(46),
    height: scale(46),
    borderRadius: scale(23),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },

  // Emoji Drawer
  emojiDrawer: {
    height: scale(220),
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  emojiTabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  emojiTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: scale(4),
    paddingVertical: scale(8),
  },
  emojiTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.brand,
  },
  emojiTabText: {
    fontSize: scale(12),
    color: colors.muted,
    fontWeight: "500",
  },
  emojiTabTextActive: {
    color: colors.brand,
    fontWeight: "700",
  },
  emojiGridScroll: {
    flex: 1,
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: scale(8),
  },
  emojiBtn: {
    width: "14.28%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiChar: {
    fontSize: scale(24),
  },
  emojiBottomBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: scale(16),
    paddingVertical: scale(6),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  emojiActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
    paddingVertical: scale(4),
    paddingHorizontal: scale(8),
  },
  emojiActionText: {
    fontSize: scale(13),
    fontWeight: "600",
    color: colors.text,
  },
  emojiDeleteBtn: {
    marginLeft: "auto",
  },

  // WhatsApp-Style Attachment Sheet (Reference media_1788935104689.png)
  whatsappAttachmentSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: scale(22),
    borderTopRightRadius: scale(22),
    paddingTop: scale(10),
    paddingBottom: scale(20),
    paddingHorizontal: scale(16),
  },
  whatsappActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingVertical: scale(8),
  },
  whatsappActionItem: {
    width: "25%",
    alignItems: "center",
    marginBottom: scale(14),
  },
  whatsappPillTile: {
    width: scale(54),
    height: scale(54),
    borderRadius: scale(27),
    backgroundColor: colors.subtle,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: scale(6),
    borderWidth: 1,
    borderColor: colors.border,
  },
  whatsappActionLabel: {
    fontSize: scale(12),
    fontWeight: "500",
    color: colors.text,
    textAlign: "center",
  },
  recentPhotosSection: {
    marginTop: scale(6),
    paddingTop: scale(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  recentPhotosGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: scale(6),
  },
  recentPhotoThumbWrap: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: scale(8),
    overflow: "hidden",
    backgroundColor: colors.subtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentPhotoThumb: {
    width: "100%",
    height: "100%",
  },

  // Contact Picker Modal
  contactSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: scale(20),
    borderTopRightRadius: scale(20),
    padding: scale(16),
    paddingBottom: scale(30),
    maxHeight: "80%",
  },
  contactSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    paddingBottom: scale(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: scale(8),
  },
  contactSheetTitle: {
    fontSize: scale(16),
    fontWeight: "700",
    color: colors.text,
  },
  contactPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(12),
    paddingVertical: scale(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  contactAvatar: {
    width: scale(38),
    height: scale(38),
    borderRadius: scale(19),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  contactAvatarText: {
    color: colors.onFill,
    fontSize: scale(13),
    fontWeight: "700",
  },
  contactPickerName: {
    fontSize: scale(14),
    fontWeight: "600",
    color: colors.text,
  },
  contactPickerSub: {
    fontSize: scale(12),
    color: colors.muted,
    marginTop: scale(2),
  },

  // Poll Creation Modal
  pollInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(10),
    paddingHorizontal: scale(12),
    paddingVertical: scale(10),
    fontSize: scale(14),
    color: colors.text,
    marginTop: scale(10),
  },
  pollSendBtn: {
    backgroundColor: "#00a884",
    borderRadius: scale(12),
    paddingVertical: scale(12),
    alignItems: "center",
    marginTop: scale(14),
  },
  pollSendBtnText: {
    color: "#ffffff",
    fontSize: scale(15),
    fontWeight: "700",
  },

  // Attendance Bubble Card (Matching reference screenshot table)
  attendanceCard: {
    minWidth: scale(260),
    maxWidth: scale(300),
    backgroundColor: colors.card,
    borderRadius: scale(10),
    padding: scale(10),
    borderWidth: 1,
    borderColor: colors.border,
    gap: scale(6),
  },
  attendanceCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  attendanceCardTitle: {
    fontSize: scale(14),
    fontWeight: "700",
    color: colors.text,
  },
  attendancePillTabs: {
    flexDirection: "row",
    backgroundColor: colors.subtle,
    borderRadius: scale(14),
    padding: scale(2),
  },
  attendanceTabInactive: {
    paddingHorizontal: scale(8),
    paddingVertical: scale(3),
    borderRadius: scale(12),
  },
  attendanceTabInactiveText: {
    fontSize: scale(11),
    color: colors.muted,
  },
  attendanceTabActive: {
    backgroundColor: "#2563eb",
    paddingHorizontal: scale(8),
    paddingVertical: scale(3),
    borderRadius: scale(12),
  },
  attendanceTabActiveText: {
    fontSize: scale(11),
    color: "#ffffff",
    fontWeight: "600",
  },
  attendanceDateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: scale(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  attendanceDateText: {
    fontSize: scale(12),
    fontWeight: "600",
    color: colors.muted,
  },
  attendanceStatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: scale(4),
  },
  attendanceStatItem: {
    fontSize: scale(11.5),
    color: colors.text,
  },
  attendanceTable: {
    borderRadius: scale(6),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  attendanceTableRowHeader: {
    flexDirection: "row",
    backgroundColor: colors.subtle,
    paddingVertical: scale(5),
    paddingHorizontal: scale(6),
  },
  attendanceTableRow: {
    flexDirection: "row",
    paddingVertical: scale(5),
    paddingHorizontal: scale(6),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  attendanceTableCell: {
    fontSize: scale(11),
    color: colors.text,
  },

  // Contact Message Card
  contactCard: {
    minWidth: scale(200),
    gap: scale(8),
  },
  contactCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
  },
  contactCardAvatar: {
    width: scale(38),
    height: scale(38),
    borderRadius: scale(19),
    backgroundColor: "#0284c7",
    alignItems: "center",
    justifyContent: "center",
  },
  contactCardAvatarText: {
    color: "#ffffff",
    fontSize: scale(13),
    fontWeight: "700",
  },
  contactCardName: {
    fontSize: scale(14),
    fontWeight: "600",
    color: colors.text,
  },
  contactCardSub: {
    fontSize: scale(11.5),
    color: colors.muted,
  },
  contactCardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: scale(2),
  },
  contactCardAction: {
    paddingVertical: scale(4),
    alignItems: "center",
  },
  contactCardActionText: {
    color: "#0284c7",
    fontSize: scale(13),
    fontWeight: "600",
  },

  // Poll Message Card
  pollCard: {
    minWidth: scale(210),
    gap: scale(8),
  },
  pollTitle: {
    fontSize: scale(14),
    fontWeight: "700",
    color: colors.text,
  },
  pollOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    paddingVertical: scale(3),
  },
  pollOptionText: {
    fontSize: scale(13),
    color: colors.text,
    flex: 1,
  },
  pollVoteCount: {
    fontSize: scale(11),
    color: colors.muted,
  },

  // Event Message Card
  eventCard: {
    minWidth: scale(210),
  },
  eventCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
  },
  eventCardTitle: {
    fontSize: scale(13.5),
    fontWeight: "700",
    color: colors.text,
  },
  eventCardDetails: {
    fontSize: scale(11.5),
    color: colors.muted,
    marginTop: scale(2),
  },

  // Bubble rich attachments
  voiceNoteWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    minWidth: scale(180),
    paddingVertical: scale(2),
  },
  voicePlayBtn: {
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  voicePlayBtnMine: {
    backgroundColor: colors.onFill,
  },
  voiceWaveColumn: {
    flex: 1,
    gap: scale(4),
  },
  voiceWaveBars: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(3),
    height: scale(26),
  },
  voiceBar: {
    width: scale(3),
    backgroundColor: colors.border,
    borderRadius: scale(2),
  },
  voiceBarActive: {
    backgroundColor: colors.accent,
  },
  voiceBarMine: {
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  voiceBarMineActive: {
    backgroundColor: colors.onFill,
  },
  voiceDuration: {
    fontSize: scale(10),
    color: colors.muted,
  },
  voiceDurationMine: {
    color: colors.onFillMuted,
  },
  attachmentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    minWidth: scale(200),
    paddingVertical: scale(2),
  },
  attachmentBadge: {
    width: scale(38),
    height: scale(38),
    borderRadius: scale(19),
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentDocTitle: {
    fontSize: scale(13.5),
    fontWeight: "600",
    color: colors.text,
  },
  attachmentDocSub: {
    fontSize: scale(11),
    color: colors.muted,
    marginTop: scale(2),
  },
  photoCard: {
    minWidth: scale(200),
    gap: scale(6),
  },
  photoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
  },
  photoTitle: {
    fontSize: scale(13),
    fontWeight: "600",
    color: colors.text,
  },
  photoPlaceholder: {
    height: scale(90),
    backgroundColor: "rgba(0,0,0,0.06)",
    borderRadius: scale(8),
    alignItems: "center",
    justifyContent: "center",
    gap: scale(6),
  },
  photoPlaceholderText: {
    fontSize: scale(11),
    color: colors.muted,
  },
  realPhotoImage: {
    width: "100%",
    height: scale(160),
    borderRadius: scale(8),
    marginTop: scale(4),
  },
})
