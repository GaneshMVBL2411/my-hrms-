import { useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import * as Print from "expo-print"
import * as Sharing from "expo-sharing"
// The legacy entry point deliberately: Android's Storage Access Framework —
// the thing that lets someone name a folder and write into it — has no
// equivalent in the newer File/Directory API yet, and a share sheet is not the
// same action.
import * as LegacyFS from "expo-file-system/legacy"
import * as SecureStore from "expo-secure-store"
import {
  employeeOptions,
  generateLetter,
  viewLetter,
  type EmployeeOption,
  type LetterPayload,
  type LetterType,
} from "./api"
import {
  buildLetter,
  letterAsHtml,
  DEFAULT_NOTICE_PERIOD,
  DEFAULT_PROBATION,
  LETTER_CHOICES,
  LETTER_TITLES,
  STATES_TERMS,
  type LetterDoc,
} from "./letters"
import { scale, FONT_SCALE_CAP } from "./ui"
import { lightColors, useStyles, useTheme, type Palette } from "./theme"

/**
 * Offer and joining letters, issued and read on the phone.
 *
 * Two pieces: a sheet that collects what a letter needs and calls
 * generate_letter, and a full-screen view of the resulting document. They are
 * together in one file because the first always ends in the second — a letter
 * that has been generated is immediately shown, which is the only way to know
 * it says what was intended before it goes anywhere.
 *
 * Neither re-implements the letter. generate_letter records it and resolves the
 * payload, letters.ts turns that into a document, and this only lays it out —
 * so the wording is the portal's wording, not a phone-shaped paraphrase of it.
 */

// ---------------------------------------------------------------- viewing

/**
 * Where this device has been told to put downloaded letters.
 *
 * A Storage Access Framework grant is persistable, so it is worth keeping: it
 * is the difference between naming a folder once and naming it for every
 * letter. Stored per-install rather than per-account, because it describes the
 * phone rather than the person.
 */
const SAVE_FOLDER_KEY = "hrms.letters.folderUri"

/**
 * Writes the PDF into the folder this phone has already granted, asking for
 * one only if there is none.
 *
 * Returns false when the person declines, which is a decision and not an
 * error. A stored grant can also stop working — the folder deleted, the card
 * removed, the permission revoked in settings — so a failed write clears it
 * and asks again rather than failing forever on a folder that is gone.
 */
async function saveToChosenFolder(base64: string, name: string): Promise<boolean> {
  const SAF = LegacyFS.StorageAccessFramework
  const write = async (directoryUri: string) => {
    const target = await SAF.createFileAsync(directoryUri, name, "application/pdf")
    await LegacyFS.writeAsStringAsync(target, base64, { encoding: "base64" })
  }

  const remembered = await SecureStore.getItemAsync(SAVE_FOLDER_KEY).catch(() => null)
  if (remembered) {
    try {
      await write(remembered)
      return true
    } catch {
      await SecureStore.deleteItemAsync(SAVE_FOLDER_KEY).catch(() => undefined)
    }
  }

  const permission = await SAF.requestDirectoryPermissionsAsync().catch(() => null)
  if (!permission?.granted) return false

  await write(permission.directoryUri)
  // Stored only after a write has actually succeeded, so a folder that cannot
  // be written to is never remembered as the one that can.
  await SecureStore.setItemAsync(SAVE_FOLDER_KEY, permission.directoryUri).catch(() => undefined)
  return true
}

export function LetterDocumentModal({
  letterId,
  preloaded,
  onClose,
}: {
  /** Fetched when opened from the history; ignored when `preloaded` is given. */
  letterId: number | null
  /** A letter just generated, already in hand — shown without a second fetch. */
  preloaded?: LetterPayload | null
  onClose: () => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [payload, setPayload] = useState<LetterPayload | null>(preloaded ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (preloaded || letterId === null) return
    let live = true
    setPayload(null)
    setError(null)
    viewLetter(letterId)
      .then((p) => live && setPayload(p))
      // get_letter_view refuses a letter that is neither yours nor yours to
      // issue, and says so. That message is better than anything invented here.
      .catch((e) => live && setError((e as Error).message || "Could not open this letter"))
    return () => {
      live = false
    }
  }, [letterId, preloaded])

  const doc = useMemo(() => (payload ? buildLetter(payload) : null), [payload])

  /**
   * Saves the letter as a PDF, without a dialog wherever that is possible.
   *
   * "Directly" costs one prompt on Android and none after it, and that is a
   * platform limit rather than a choice. Under scoped storage an app cannot
   * write into a folder someone can find — Downloads, say — unless they have
   * named it once. The grant that comes back is persistable, so it is kept and
   * reused: the first letter asks where, every letter after it just saves.
   *
   * iOS has no such restriction on the app's own documents folder, and with
   * UIFileSharingEnabled declared that folder *is* the app's entry in Files.
   * So there the write is direct from the very first letter.
   */
  async function download() {
    if (!doc || saving) return
    setSaving(true)
    try {
      const name = `${doc.title.replace(/[^A-Za-z0-9]+/g, "_")}_${
        doc.employeeCode || doc.employeeName.replace(/[^A-Za-z0-9]+/g, "_")
      }.pdf`
      // The bytes come back with the file rather than being read from it
      // afterwards. printToFileAsync writes into the print module's own cache
      // directory, which is outside the sandbox the file-system module will
      // read from — reading it back failed with "isn't readable", and the fix
      // is not to widen the sandbox but to stop needing the read.
      const printed = await Print.printToFileAsync({ html: letterAsHtml(doc), base64: true })
      const base64 = printed.base64
      if (!base64) throw new Error("The PDF was created but came back empty.")

      if (Platform.OS !== "android") {
        // Straight into the folder the Files app shows under this app's name.
        await LegacyFS.writeAsStringAsync(`${LegacyFS.documentDirectory}${name}`, base64, {
          encoding: "base64",
        })
        Alert.alert("Downloaded", `${name} is in Files, under Whhoohh Path HRMS.`)
        return
      }

      const saved = await saveToChosenFolder(base64, name)
      if (saved) {
        Alert.alert("Downloaded", `${name} has been saved.`)
        return
      }

      // Only reached if someone declines the one-time folder prompt. Handing
      // them the finished PDF is better than losing it over a dismissed dialog.
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(printed.uri, {
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
          dialogTitle: name,
        })
      }
    } catch (e) {
      Alert.alert("Not saved", (e as Error).message || "The letter could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + scale(10) }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.back}>
              ‹ Close
            </Text>
          </TouchableOpacity>
          {doc && (
            <TouchableOpacity
              style={[styles.shareBtn, saving && { opacity: 0.6 }]}
              onPress={download}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.onFill} size="small" />
              ) : (
                <Ionicons name="download-outline" size={scale(15)} color={colors.onFill} />
              )}
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.shareText}>
                {saving ? "Saving…" : "Download"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {error ? (
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
            {error}
          </Text>
        ) : !doc ? (
          <ActivityIndicator style={{ marginTop: scale(28) }} color={colors.accent} />
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + scale(28) }}
            showsVerticalScrollIndicator={false}
          >
            <LetterBody doc={doc} />
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

/**
 * The letter itself, on a sheet of paper.
 *
 * Laid out in the order the Word templates use, and given a white page with a
 * ruled letterhead rather than the app's list styling — a letter that looks
 * like another screen of the app does not read as a document someone is meant
 * to sign.
 */
function LetterBody({ doc }: { doc: LetterDoc }) {
  const styles = useStyles(makeStyles)
  return (
    <View style={styles.page}>
      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.company}>
        {doc.companyName}
      </Text>
      {!!doc.companyAddress && (
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.companyAddress}>
          {doc.companyAddress}
        </Text>
      )}
      <View style={styles.rule} />

      <View style={styles.refRow}>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.ref}>
          {doc.refLine}
        </Text>
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.ref}>
          {doc.dateLine}
        </Text>
      </View>

      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.docTitle}>
        {doc.title}
      </Text>

      {doc.recipient && (
        <View style={{ marginTop: scale(14) }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recipient}>
            {doc.recipient.name}
          </Text>
          {!!doc.recipient.address && (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.recipientAddress}>
              {doc.recipient.address}
            </Text>
          )}
        </View>
      )}

      {!!doc.subject && (
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.subject}>
          Subject: {doc.subject}
        </Text>
      )}

      <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.salutation}>
        {doc.salutation}
      </Text>

      {doc.body.map((paragraph, i) => (
        <Text key={i} maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.paragraph}>
          {paragraph}
        </Text>
      ))}

      <View style={styles.details}>
        {doc.details.map((d, i) => (
          <View key={d.label} style={[styles.detailRow, i === doc.details.length - 1 && styles.detailLast]}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.detailLabel}>
              {d.label}
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.detailValue}>
              {d.value}
            </Text>
          </View>
        ))}
      </View>

      {!!doc.closing && (
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.paragraph}>
          {doc.closing}
        </Text>
      )}
      {!!doc.note && (
        <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.note}>
          {doc.note}
        </Text>
      )}

      <View style={styles.signBlock}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signLine}>
            {doc.signOff}
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signName}>
            Authorised Signatory
          </Text>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signRole}>
            Designated Partner / Head — Human Resources
          </Text>
        </View>

        {!!doc.countersignedBy && (
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signLine}>
              Accepted and agreed
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signName}>
              {doc.countersignedBy}
            </Text>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.signRole}>
              Signature / Date
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

// -------------------------------------------------------------- generating

/**
 * The form HR fills in to issue a letter.
 *
 * Everything except the person and the type is optional, and the two that are
 * not are chosen from lists rather than typed — a letter addressed to a
 * mistyped name is worse than no letter. CTC, probation and notice appear only
 * for the offer and joining letters, because those are the only two that state
 * terms; an experience certificate has no CTC to quote and asking for one would
 * invite someone to fill it in.
 */
export function GenerateLetterSheet({
  onClose,
  onGenerated,
}: {
  onClose: () => void
  /** Handed the new letter so it can be shown straight away. */
  onGenerated: (letter: LetterPayload) => void
}) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const [people, setPeople] = useState<EmployeeOption[] | null>(null)
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [letterType, setLetterType] = useState<LetterType>("offer")
  const [ctc, setCtc] = useState("")
  const [probation, setProbation] = useState(DEFAULT_PROBATION)
  const [notice, setNotice] = useState(DEFAULT_NOTICE_PERIOD)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    employeeOptions()
      .then(setPeople)
      .catch(() => setPeople([]))
  }, [])

  const statesTerms = STATES_TERMS.includes(letterType)
  const needle = search.trim().toLowerCase()
  const shown = (people ?? []).filter(
    (p) => !needle || p.full_name.toLowerCase().includes(needle)
  )
  const chosen = (people ?? []).find((p) => p.id === employeeId) ?? null

  async function submit() {
    if (employeeId === null) {
      Alert.alert("Select employee", "Please select an employee from the list before generating the letter.")
      return
    }
    setBusy(true)
    try {
      const letter = await generateLetter({
        employeeId,
        letterType,
        customMessage: message,
        // A blank CTC is left unsent so the function falls back to the
        // employee's salary structure. Number("") is 0, which would put
        // "₹0 per annum" on an offer letter, so the check is on the text.
        annualCtc: ctc.trim() ? Number(ctc.trim()) : undefined,
        probationText: statesTerms ? probation : undefined,
        noticePeriodText: statesTerms ? notice : undefined,
      })
      onGenerated(letter)
    } catch (e) {
      Alert.alert("Not generated", (e as Error).message || "Could not generate the letter")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + scale(10) }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.back}>
              ‹ Cancel
            </Text>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.heading}>
            Generate letter
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + scale(28) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.label}>
            Letter type
          </Text>
          <View style={styles.chips}>
            {LETTER_CHOICES.map((c) => (
              <TouchableOpacity
                key={c.value}
                style={[styles.chip, letterType === c.value && styles.chipOn]}
                onPress={() => setLetterType(c.value)}
              >
                <Text
                  maxFontSizeMultiplier={FONT_SCALE_CAP}
                  style={[styles.chipText, letterType === c.value && styles.chipTextOn]}
                >
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.label}>
            Employee
          </Text>
          {chosen ? (
            <TouchableOpacity style={styles.chosen} onPress={() => setEmployeeId(null)}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.chosenName}>
                  {chosen.full_name}
                </Text>
                {!!chosen.designation_title && (
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.chosenRole}>
                    {chosen.designation_title}
                  </Text>
                )}
              </View>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.change}>
                Change
              </Text>
            </TouchableOpacity>
          ) : people === null ? (
            <ActivityIndicator style={{ marginTop: scale(12) }} color={colors.accent} />
          ) : (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={scale(18)} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search people"
                  placeholderTextColor={colors.faint}
                  autoCorrect={false}
                  maxFontSizeMultiplier={FONT_SCALE_CAP}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={scale(18)} color={colors.faint} />
                  </TouchableOpacity>
                )}
              </View>
              {/* Capped rather than scrolled inside a scroll view: nesting two
                  vertical scrollers makes both feel broken, and ten names is
                  enough to pick from once the search box has narrowed it. */}
              {shown.slice(0, 10).map((p) => (
                <TouchableOpacity key={p.id} style={styles.person} onPress={() => setEmployeeId(p.id)}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.personName}>
                    {p.full_name}
                  </Text>
                  {!!p.designation_title && (
                    <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.personRole}>
                      {p.designation_title}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
              {shown.length === 0 && (
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.empty}>
                  {people.length === 0 ? "No employees to write to." : "Nobody by that name."}
                </Text>
              )}
              {shown.length > 10 && (
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.more}>
                  {shown.length - 10} more — narrow the search.
                </Text>
              )}
            </>
          )}

          {statesTerms && (
            <>
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.label}>
                Annual CTC
              </Text>
              <TextInput
                style={styles.input}
                value={ctc}
                onChangeText={setCtc}
                keyboardType="number-pad"
                placeholder="e.g. 900000"
                placeholderTextColor={colors.faint}
                maxFontSizeMultiplier={FONT_SCALE_CAP}
              />
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.hint}>
                Leave blank to use the employee's salary structure, if any.
              </Text>

              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.label}>
                Probation
              </Text>
              <TextInput
                style={styles.input}
                value={probation}
                onChangeText={setProbation}
                maxFontSizeMultiplier={FONT_SCALE_CAP}
              />

              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.label}>
                Notice period
              </Text>
              <TextInput
                style={styles.input}
                value={notice}
                onChangeText={setNotice}
                maxFontSizeMultiplier={FONT_SCALE_CAP}
              />
            </>
          )}

          <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.label}>
            Custom message (optional)
          </Text>
          <TextInput
            style={[styles.input, { minHeight: scale(80), textAlignVertical: "top" }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Added below the letter"
            placeholderTextColor={colors.faint}
            multiline
            maxLength={500}
            maxFontSizeMultiplier={FONT_SCALE_CAP}
          />

          <TouchableOpacity
            style={[styles.primary, busy && { opacity: 0.5 }]}
            disabled={busy}
            onPress={submit}
          >
            {busy ? (
              <ActivityIndicator color={colors.onFill} />
            ) : (
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.primaryText}>
                Generate
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: scale(16) },
  header: { flexDirection: "row", alignItems: "center", gap: scale(12), marginBottom: scale(8) },
  back: { fontSize: scale(15), color: colors.accent, fontWeight: "600" },
  heading: { fontSize: scale(18), fontWeight: "700", color: colors.text },
  shareBtn: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
    backgroundColor: colors.brand,
    borderRadius: scale(8),
    paddingHorizontal: scale(14),
    minHeight: scale(36),
  },
  shareText: { color: colors.onFill, fontWeight: "700", fontSize: scale(13) },
  empty: { textAlign: "center", color: colors.muted, fontSize: scale(13), marginTop: scale(28) },

  // ------------------------------------------------------------- the page
  // Pinned to the light palette rather than the active one, and deliberately.
  // This block is a preview of a printed letter, not app chrome: the paper is
  // white on paper, so the ink on it stays dark whatever theme the app is in.
  // Theming it would give a dark-mode reader white text on a white page.
  page: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: scale(10),
    padding: scale(18),
    marginTop: scale(6),
  },
  company: { fontSize: scale(16), fontWeight: "700", color: lightColors.brand, textAlign: "center" },
  companyAddress: {
    fontSize: scale(11),
    color: lightColors.muted,
    textAlign: "center",
    marginTop: scale(2),
  },
  rule: { height: 2, backgroundColor: lightColors.brand, marginTop: scale(10), opacity: 0.85 },
  refRow: { flexDirection: "row", justifyContent: "space-between", gap: scale(8), marginTop: scale(10) },
  ref: { fontSize: scale(10), color: lightColors.muted },
  docTitle: {
    fontSize: scale(14),
    fontWeight: "700",
    color: lightColors.brand,
    textAlign: "center",
    letterSpacing: 0.6,
    marginTop: scale(16),
  },
  recipient: { fontSize: scale(13), fontWeight: "600", color: lightColors.text },
  recipientAddress: { fontSize: scale(12), color: lightColors.muted, marginTop: scale(2) },
  subject: { fontSize: scale(12.5), fontWeight: "700", color: lightColors.text, marginTop: scale(14) },
  salutation: { fontSize: scale(13), color: lightColors.text, marginTop: scale(12) },
  paragraph: { fontSize: scale(13), lineHeight: scale(20), color: lightColors.text, marginTop: scale(11) },
  note: {
    fontSize: scale(12.5),
    lineHeight: scale(19),
    color: lightColors.muted,
    fontStyle: "italic",
    marginTop: scale(11),
  },
  details: {
    marginTop: scale(14),
    borderWidth: 1,
    borderColor: "#eaf0ec",
    backgroundColor: "#f8faf9",
    borderRadius: scale(6),
    paddingHorizontal: scale(12),
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: scale(12),
    paddingVertical: scale(7),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eaf0ec",
  },
  detailLast: { borderBottomWidth: 0 },
  detailLabel: { fontSize: scale(12), color: lightColors.muted },
  detailValue: { fontSize: scale(12), fontWeight: "600", color: lightColors.text, flexShrink: 1, textAlign: "right" },
  signBlock: { flexDirection: "row", gap: scale(16), marginTop: scale(30) },
  signLine: { fontSize: scale(12.5), color: lightColors.text },
  signName: { fontSize: scale(12.5), fontWeight: "600", color: lightColors.text, marginTop: scale(30) },
  signRole: { fontSize: scale(10.5), color: lightColors.muted, marginTop: scale(2) },

  // -------------------------------------------------------------- the form
  label: { fontSize: scale(12), fontWeight: "700", color: colors.muted, marginTop: scale(16) },
  hint: { fontSize: scale(11), color: colors.faint, marginTop: scale(4) },
  input: {
    marginTop: scale(6),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(10),
    paddingHorizontal: scale(12),
    paddingVertical: scale(10),
    minHeight: scale(44),
    fontSize: scale(14),
    color: colors.text,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(8),
    backgroundColor: colors.card,
    borderRadius: scale(10),
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: scale(12),
    marginTop: scale(6),
    minHeight: scale(44),
  },
  searchInput: {
    flex: 1,
    fontSize: scale(14),
    color: colors.text,
    paddingVertical: scale(8),
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: scale(8), marginTop: scale(8) },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: scale(999),
    paddingHorizontal: scale(13),
    paddingVertical: scale(8),
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: scale(12), color: colors.text, fontWeight: "600" },
  chipTextOn: { color: colors.onFill },
  person: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: scale(10),
    padding: scale(11),
    marginTop: scale(6),
  },
  personName: { fontSize: scale(13.5), fontWeight: "600", color: colors.text },
  personRole: { fontSize: scale(11.5), color: colors.muted, marginTop: scale(2) },
  more: { fontSize: scale(11), color: colors.faint, marginTop: scale(8), textAlign: "center" },
  chosen: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(10),
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: scale(10),
    padding: scale(12),
    marginTop: scale(6),
  },
  chosenName: { fontSize: scale(14), fontWeight: "700", color: colors.text },
  chosenRole: { fontSize: scale(11.5), color: colors.muted, marginTop: scale(2) },
  change: { fontSize: scale(12), fontWeight: "700", color: colors.accent },
  primary: {
    backgroundColor: colors.brand,
    borderRadius: scale(10),
    minHeight: scale(48),
    alignItems: "center",
    justifyContent: "center",
    marginTop: scale(22),
  },
  primaryText: { color: colors.onFill, fontWeight: "700", fontSize: scale(15) },
})
