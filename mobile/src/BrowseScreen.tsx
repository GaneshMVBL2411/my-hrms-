import { useCallback, useEffect, useRef, useState } from "react"
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Alert,
  BackHandler,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { applyLeave, leaveTypes, rpc, select, type LeaveType, type LetterPayload, type SessionUser } from "./api"
import { GenerateLetterSheet, LetterDocumentModal } from "./LetterScreen"
import { SECTIONS, type RowAction, type RowView, type SectionDef, type Tone } from "./sections"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"
import { play, transformFor, MOTION_MS } from "./motion"

/**
 * The HRMS, natively: a menu of sections and a list for whichever is open.
 *
 * This is the part of the portal that is worth writing twice. A WebView renders
 * the whole app for free, but it pays for that with a page load on every tab,
 * no offline behaviour, and scrolling that never quite feels native. These five
 * are what people actually open on a phone, so they are real screens; the
 * Portal tab remains for everything not ported, rather than pretending the job
 * is finished.
 *
 * One list implementation drives all five, configured by sections.ts. Fetching,
 * refreshing, the empty state, the error state and the search box are written
 * once — a fix to any of them lands everywhere at once instead of in whichever
 * copy someone remembered.
 */
export function BrowseScreen({
  active,
  user,
  jumpTo,
  initialAction,
  onJumped,
}: {
  user: SessionUser
  /** A section key to open straight away, set when Home routes here. */
  jumpTo?: string | null
  initialAction?: boolean
  onJumped?: () => void
  /**
   * Whether this tab is the one on screen.
   *
   * Every tab stays mounted so the portal keeps its state, which means a back
   * press reaches this handler even when someone is looking at Messages. Without
   * this check, backing out of a conversation would also quietly close whatever
   * section was left open here.
   */
  active: boolean
}) {
  const styles = useStyles(makeStyles)
  const [open, setOpen] = useState<SectionDef | null>(null)
  const [triggerAction, setTriggerAction] = useState(false)
  const insets = useSafeAreaInsets()

  // Back returns to the grid of modules rather than leaving the app.
  useEffect(() => {
    if (!active || !open) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(null)
      return true
    })
    return () => sub.remove()
  }, [active, open])

  // Home's quick actions name a destination rather than just this tab, so
  // "Payslips" opens payslips instead of dropping someone on the grid to find
  // it themselves. The request is cleared once honoured, otherwise Back from
  // the section would immediately re-open it.
  useEffect(() => {
    if (!jumpTo) return
    const target = SECTIONS.find((s) => s.key === jumpTo) ?? null
    setOpen(target)
    if (initialAction) setTriggerAction(true)
    onJumped?.()
  }, [jumpTo, initialAction, onJumped])

  if (open) {
    return (
      <SectionList
        section={open}
        user={user}
        initialActionOpen={triggerAction}
        onActionOpened={() => setTriggerAction(false)}
        onBack={() => {
          setOpen(null)
          setTriggerAction(false)
        }}
      />
    )
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + scale(12) }]}>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.heading}>
        Browse
      </Text>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sub}>
        The sections that read well on a phone. The rest are in Portal.
      </Text>

      {/* A grid rather than a list: ten modules as a list is a wall of text to
          read top to bottom, while as tinted tiles they are found by colour and
          shape — which is how anyone who uses this daily will find them. */}
      <View style={styles.grid}>
        {SECTIONS.filter((s) => !s.roles || s.roles.includes(user.role)).map((s) => (
          <ModuleTile key={s.key} section={s} onOpen={() => setOpen(s)} />
        ))}
      </View>
    </View>
  )
}

/**
 * One module on the grid, which moves the way its object moves when tapped.
 *
 * The list opens after the movement rather than during it. Navigating first
 * unmounts the grid mid-animation, so the motion is written, runs for one frame
 * and is never seen — the work would be there in the code and absent from the
 * app. A few hundred milliseconds is also long enough to acknowledge the tap,
 * which a list appearing instantly does not.
 *
 * Each tile owns its own Animated.Value. Sharing one would move all ten.
 */
function ModuleTile({ section, onOpen }: { section: SectionDef; onOpen: () => void }) {
  const styles = useStyles(makeStyles)
  const v = useRef(new Animated.Value(0)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)
    return () => sub.remove()
  }, [])

  const press = () => {
    if (reduceMotion) return onOpen()
    play(section.motion, v).start()
    // Slightly ahead of the full duration: the tail of a settle is not worth
    // waiting on, and the delay should not be long enough to feel like lag.
    setTimeout(onOpen, Math.round(MOTION_MS[section.motion] * 0.7))
  }

  return (
    <TouchableOpacity style={styles.gridItem} onPress={press} activeOpacity={0.8}>
      <Animated.View
        style={[
          styles.gridIcon,
          { backgroundColor: section.tint + "1a" },
          { transform: reduceMotion ? [] : transformFor(section.motion, v) },
        ]}
      >
        <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={scale(22)} color={section.tint} />
      </Animated.View>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.gridLabel}>
        {section.title}
      </Text>
    </TouchableOpacity>
  )
}

function SectionList({
  section,
  user,
  initialActionOpen,
  onActionOpened,
  onBack,
}: {
  section: SectionDef
  user: SessionUser
  initialActionOpen?: boolean
  onActionOpened?: () => void
  onBack: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [rows, setRows] = useState<Record<string, any>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState("")
  const [actionOpen, setActionOpen] = useState(initialActionOpen ?? false)

  useEffect(() => {
    if (initialActionOpen) {
      setActionOpen(true)
      onActionOpened?.()
    }
  }, [initialActionOpen, onActionOpened])
  /** The row and action waiting on a written note, if one is being asked for. */
  const [asking, setAsking] = useState<{ row: Record<string, any>; action: RowAction } | null>(null)
  /**
   * The letter being read: an id from the history, or one just generated.
   *
   * Two fields rather than one because they arrive differently — a row tap has
   * only an id and has to fetch, while a freshly generated letter is already in
   * hand and re-fetching it would be a round trip to learn what was just said.
   */
  const [openLetterId, setOpenLetterId] = useState<number | null>(null)
  const [freshLetter, setFreshLetter] = useState<LetterPayload | null>(null)
  const insets = useSafeAreaInsets()

  const load = useCallback(async () => {
    setError(null)
    try {
      // A section marked scopeToMe is the signed-in person's own list, so the
      // filter is added here rather than written into the section: it needs the
      // session, and the section defs are a static description of the data.
      const query = section.scopeToMe
        ? {
            ...section.query,
            filters: [
              ...(section.query.filters ?? []),
              { column: "employee_id", op: "eq" as const, value: user.employeeId },
            ],
          }
        : section.query
      setRows(
        section.rpc
          ? await rpc<Record<string, any>[]>(section.rpc)
          : await select<Record<string, any>>(section.table, query)
      )
    } catch (e) {
      setRows([])
      setError((e as Error).message || "Could not load")
    }
    // The employee id is part of the query for a scoped section, so a change
    // of account has to re-run it rather than keep the previous person's list.
  }, [section, user.employeeId])

  useEffect(() => {
    setRows(null)
    load()
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // Filtered on what is rendered rather than on the raw row, so searching
  // matches what someone can actually see. Filtering server-side would mean a
  // round trip per keystroke for lists this size, which are already fully here.
  const views = (rows ?? []).map((r, i) => ({
    key: String(r.id ?? i),
    view: section.row(r),
    raw: r,
    actions: section.rowActions?.(r) ?? [],
  }))
  // A screen action may be for HR only, so the button is dropped for anyone
  // else. The database refuses regardless; this stops offering a dead end.
  const screenAction =
    section.screenAction &&
    (!section.screenAction.roles || section.screenAction.roles.includes(user.role))
      ? section.screenAction
      : null

  const needle = search.trim().toLowerCase()
  const shown = needle
    ? views.filter(({ view }) =>
        [view.title, view.subtitle, view.meta, view.badge]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : views

  return (
    <View style={[styles.root, { paddingTop: insets.top + scale(12) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.back}>
            ‹ Back
          </Text>
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.heading}>
          {section.title}
        </Text>
        {screenAction && (
          <TouchableOpacity style={styles.headerBtn} onPress={() => setActionOpen(true)}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.headerBtnText}>
              {screenAction.label}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TextInput
        style={styles.search}
        placeholder={`Search ${section.title.toLowerCase()}`}
        placeholderTextColor={colors.faint}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        maxFontSizeMultiplier={FONT_SCALE_CAP}
      />

      {rows === null ? (
        <ActivityIndicator style={{ marginTop: scale(28) }} color={colors.accent} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(item) => item.key}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
          contentContainerStyle={{ paddingBottom: scale(24) }}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
              {error ?? (needle ? `Nothing matching “${search}”.` : section.empty)}
            </Text>
          }
          renderItem={({ item }) => (
            <Row
              view={item.view}
              onPress={
                section.opens === "letter"
                  ? () => setOpenLetterId(Number(item.raw.id))
                  : item.actions.length
                    ? () => offer(item.raw, item.actions)
                    : undefined
              }
            />
          )}
        />
      )}

      {asking && (
        <NotePrompt
          prompt={asking.action.prompt!}
          onClose={() => setAsking(null)}
          onSubmit={(note) => run(asking.row, asking.action, note)}
        />
      )}

      {actionOpen && screenAction?.kind === "apply-leave" && (
        <ApplyLeave
          onClose={() => setActionOpen(false)}
          onDone={() => {
            setActionOpen(false)
            load()
          }}
        />
      )}

      {actionOpen && screenAction?.kind === "generate-letter" && (
        <GenerateLetterSheet
          onClose={() => setActionOpen(false)}
          onGenerated={(letter) => {
            // Straight into the document. A letter that has been issued but not
            // read back is one nobody has checked, and the form is the wrong
            // place to discover that a designation was missing.
            setActionOpen(false)
            setFreshLetter(letter)
            load()
          }}
        />
      )}

      {(openLetterId !== null || freshLetter) && (
        <LetterDocumentModal
          letterId={openLetterId}
          preloaded={freshLetter}
          onClose={() => {
            setOpenLetterId(null)
            setFreshLetter(null)
          }}
        />
      )}
    </View>
  )

  /**
   * Presents a row's actions and runs the chosen one.
   *
   * Alert rather than a bespoke sheet: it is the platform's own control, it
   * reads correctly at any font size, and it needs no dependency. The list is
   * reloaded afterwards rather than patched in place — the function may have
   * changed more than the one field shown, and refetching cannot disagree with
   * the database the way an optimistic edit can.
   */
  function offer(row: Record<string, any>, actions: RowAction[]) {
    Alert.alert(
      section.row(row).title,
      undefined,
      [
        ...actions.map((a) => ({
          text: a.label,
          style: a.destructive ? ("destructive" as const) : ("default" as const),
          // An action that wants a note opens the sheet instead of running:
          // the Alert closes either way, and the sheet is what collects it.
          onPress: () => (a.prompt ? setAsking({ row, action: a }) : run(row, a)),
        })),
        { text: "Cancel", style: "cancel" as const },
      ],
      { cancelable: true }
    )
  }

  async function run(row: Record<string, any>, action: RowAction, note?: string) {
    try {
      await action.run(row, note)
      setAsking(null)
      await load()
    } catch (e) {
      // The refusal comes from the database, so it says what was
      // actually wrong — shown as-is rather than replaced with a guess.
      Alert.alert("Not done", (e as Error).message || "That did not work")
    }
  }
}

/**
 * Asks for one line of text before an action runs.
 *
 * Built rather than reached for: Alert.prompt exists only on iOS, and this app
 * ships as an Android APK, so a rejection there would have gone out with no
 * reason at all while looking like it had asked.
 *
 * `minLength` of 0 makes the note optional — that is an approval adding a word
 * of context, where a rejection has to say something.
 */
function NotePrompt({
  prompt,
  onClose,
  onSubmit,
}: {
  prompt: { title: string; placeholder: string; minLength: number }
  onClose: () => void
  onSubmit: (note: string) => Promise<void> | void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const short = note.trim().length < prompt.minLength

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetTitle}>
            {prompt.title}
          </Text>
          <TextInput
            style={[styles.search, { marginTop: 0, minHeight: 88, textAlignVertical: "top" }]}
            value={note}
            onChangeText={setNote}
            placeholder={prompt.placeholder}
            placeholderTextColor={colors.faint}
            multiline
            autoFocus
            maxLength={500}
            maxFontSizeMultiplier={FONT_SCALE_CAP}
          />
          <View style={styles.sheetButtons}>
            <TouchableOpacity style={[styles.sheetBtn, styles.sheetGhost]} onPress={onClose}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetGhostText}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetPrimary, (busy || short) && { opacity: 0.5 }]}
              disabled={busy || short}
              onPress={async () => {
                setBusy(true)
                try {
                  await onSubmit(note.trim())
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.onFill} />
              ) : (
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetPrimaryText}>
                  Send
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

/**
 * A leave request, filled in on the phone.
 *
 * Dates are typed rather than picked. A date picker is another native module
 * and another set of platform differences, and this form is used a handful of
 * times a year — the field is pre-filled with today so the format is shown
 * rather than explained.
 */
function ApplyLeave({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const today = new Date().toISOString().slice(0, 10)
  const [types, setTypes] = useState<LeaveType[]>([])
  const [typeId, setTypeId] = useState<number | null>(null)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    leaveTypes().then((t) => {
      setTypes(t)
      setTypeId(t[0]?.id ?? null)
    })
  }, [])

  async function submit() {
    if (typeId === null) return
    setBusy(true)
    try {
      await applyLeave(typeId, start, end, reason)
      onDone()
    } catch (e) {
      // apply_leave raises the real reason — no balance, dates the wrong way
      // round — and that is more useful than anything invented here.
      Alert.alert("Not applied", (e as Error).message || "Could not apply")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetTitle}>
            Apply for leave
          </Text>

          <View style={styles.chips}>
            {types.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.chip, typeId === t.id && styles.chipOn]}
                onPress={() => setTypeId(t.id)}
              >
                <Text
                  maxFontSizeMultiplier={FONT_SCALE_CAP}
                  style={[styles.chipText, typeId === t.id && styles.chipTextOn]}
                >
                  {t.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.dates}>
            <TextInput style={[styles.search, styles.date]} value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} maxFontSizeMultiplier={FONT_SCALE_CAP} />
            <TextInput style={[styles.search, styles.date]} value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} maxFontSizeMultiplier={FONT_SCALE_CAP} />
          </View>

          <TextInput
            style={[styles.search, { marginTop: 0 }]}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            placeholderTextColor={colors.faint}
            maxFontSizeMultiplier={FONT_SCALE_CAP}
          />

          <View style={styles.sheetButtons}>
            <TouchableOpacity style={[styles.sheetBtn, styles.sheetGhost]} onPress={onClose}>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetGhostText}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetPrimary, (busy || typeId === null) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={busy || typeId === null}
            >
              {busy ? (
                <ActivityIndicator color={colors.onFill} />
              ) : (
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.sheetPrimaryText}>
                  Apply
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function Row({ view, onPress }: { view: RowView; onPress?: () => void }) {
  const styles = useStyles(makeStyles)
  const tones = useStyles(makeTones)
  const Wrapper: any = onPress ? TouchableOpacity : View
  return (
    <Wrapper style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowMain}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={1} style={styles.rowTitle}>
          {view.title}
        </Text>
        {!!view.subtitle && (
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} numberOfLines={2} style={styles.rowSub}>
            {view.subtitle}
          </Text>
        )}
        {!!view.badge && (
          <View style={[styles.badge, tones.fill[view.tone ?? "neutral"]]}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={[styles.badgeText, tones.text[view.tone ?? "neutral"]]}>
              {view.badge}
            </Text>
          </View>
        )}
      </View>
      {!!view.meta && (
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.rowMeta}>
          {view.meta}
        </Text>
      )}
    </Wrapper>
  )
}

/**
 * The status pills, per theme.
 *
 * The pair is what carries the meaning: a pale fill with dark text in light
 * mode, a dim fill of the same hue with bright text in dark mode. Inverting one
 * without the other is what turns "Approved" into unreadable green-on-green.
 */
const makeTones = (colors: Palette) => ({
  fill: {
    neutral: { backgroundColor: colors.subtle },
    success: { backgroundColor: colors.successBg },
    warning: { backgroundColor: colors.warningBg },
    danger: { backgroundColor: colors.dangerBg },
  } as Record<Tone, { backgroundColor: string }>,
  text: {
    neutral: { color: colors.subtleText },
    success: { color: colors.successText },
    warning: { color: colors.warningText },
    danger: { color: colors.dangerText },
  } as Record<Tone, { color: string }>,
})

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: scale(16) },
  header: { flexDirection: "row", alignItems: "center", gap: scale(12) },
  back: { fontSize: scale(15), color: colors.accent, fontWeight: "600" },
  heading: { fontSize: scale(22), fontWeight: "700", color: colors.text },
  sub: { fontSize: scale(12), color: colors.muted, marginTop: scale(4) },
  grid: { marginTop: scale(16), flexDirection: "row", flexWrap: "wrap", gap: scale(10) },
  // Four across on a normal phone: 25% less the gap, so rows stay even.
  gridItem: { width: "22%", alignItems: "center", gap: scale(6), marginBottom: scale(10) },
  gridIcon: { width: scale(54), height: scale(54), borderRadius: scale(15), alignItems: "center", justifyContent: "center" },
  gridLabel: { fontSize: scale(11), color: colors.text, fontWeight: "600", textAlign: "center" },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: scale(15),
    paddingHorizontal: scale(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: scale(52),
  },
  menuLabel: { fontSize: scale(15), fontWeight: "600", color: colors.text },
  chevron: { fontSize: scale(22), color: colors.faint },
  search: {
    marginTop: scale(12),
    marginBottom: scale(8),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(10),
    paddingHorizontal: scale(12),
    minHeight: scale(44),
    fontSize: scale(14),
    color: colors.text,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: scale(10),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(10),
    padding: scale(12),
    marginBottom: scale(8),
  },
  rowMain: { flex: 1, gap: scale(3) },
  rowTitle: { fontSize: scale(14), fontWeight: "600", color: colors.text },
  rowSub: { fontSize: scale(12), color: colors.muted },
  rowMeta: { fontSize: scale(12), color: colors.muted, fontWeight: "600" },
  badge: { alignSelf: "flex-start", borderRadius: scale(6), paddingHorizontal: scale(7), paddingVertical: scale(2), marginTop: scale(2) },
  badgeText: { fontSize: scale(10), fontWeight: "700", textTransform: "capitalize" },
  empty: { textAlign: "center", color: colors.muted, fontSize: scale(13), marginTop: scale(28) },
  // Pushed to the far end of the header row, past the title.
  headerBtn: {
    marginLeft: "auto",
    backgroundColor: colors.brand,
    borderRadius: scale(8),
    paddingHorizontal: scale(14),
    minHeight: scale(36),
    justifyContent: "center",
  },
  headerBtnText: { color: colors.onFill, fontWeight: "700", fontSize: scale(13) },

  // the apply-leave sheet
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,23,42,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: scale(18),
  },
  sheet: {
    width: "100%",
    backgroundColor: colors.card,
    borderRadius: scale(14),
    padding: scale(16),
    gap: scale(10),
  },
  sheetTitle: { fontSize: scale(17), fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: scale(6) },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(20),
    paddingHorizontal: scale(12),
    paddingVertical: scale(7),
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: scale(12), color: colors.muted, fontWeight: "600" },
  chipTextOn: { color: colors.onFill },
  dates: { flexDirection: "row", gap: scale(8) },
  date: { flex: 1, marginTop: 0, marginBottom: 0 },
  sheetButtons: { flexDirection: "row", gap: scale(8), marginTop: scale(4) },
  sheetBtn: {
    flex: 1,
    borderRadius: scale(10),
    minHeight: scale(46),
    alignItems: "center",
    justifyContent: "center",
  },
  sheetGhost: { borderWidth: 1, borderColor: colors.border },
  sheetGhostText: { color: colors.muted, fontWeight: "600", fontSize: scale(14) },
  sheetPrimary: { backgroundColor: colors.brand },
  sheetPrimaryText: { color: colors.onFill, fontWeight: "700", fontSize: scale(14) },
})
