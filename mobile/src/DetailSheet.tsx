import { useState } from "react"
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Ionicons } from "@expo/vector-icons"
import { scale, FONT_SCALE_CAP } from "./ui"
import { useStyles, useTheme, type Palette } from "./theme"
import { savePdf, toBase64 } from "./download"

/**
 * What a row opens into: everything the list had room to hint at.
 *
 * A list row shows a title, a line of subtitle and a badge, and for a policy
 * that is the first sentence of a document; for a payslip it is the net pay
 * with the eight lines that produce it hidden. This is where the rest goes.
 * `body` is for prose — the policy text, a project's description — and
 * `fields` for the label/value pairs that are not prose.
 */
export interface DetailView {
  title: string
  subtitle?: string
  /** A short tag beside the title: a status, a version, a type. */
  badge?: string
  body?: string | null
  fields?: { label: string; value: string | null | undefined }[]
  /**
   * A file this thing can be taken away as. The sheet shows a Download
   * button and saves whatever `fetch` returns under `name`; the caller only
   * says where the bytes come from.
   */
  download?: { name: string; fetch: () => Promise<ArrayBuffer> }
}

/**
 * A full-height sheet over the list, for reading one thing properly.
 *
 * A Modal rather than a pushed screen, for the same reason the letter viewer
 * and the task detail are: there is one level of drill-down in this app and
 * a navigator would be four dependencies to replace a boolean. Being a Modal
 * also means Android's back button closes it for free.
 */
export function DetailSheet({ view, onClose }: { view: DetailView | null; onClose: () => void }) {
  const { colors } = useTheme()
  const styles = useStyles(makeStyles)
  const insets = useSafeAreaInsets()
  const [saving, setSaving] = useState(false)
  if (!view) return null

  const fields = (view.fields ?? []).filter((f) => f.value !== null && f.value !== undefined && f.value !== "")

  async function download() {
    if (!view?.download || saving) return
    setSaving(true)
    try {
      const bytes = await view.download.fetch()
      await savePdf(toBase64(bytes), view.download.name)
    } catch (e) {
      Alert.alert("Not saved", (e as Error).message || "The file could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible presentationStyle="pageSheet">
      <View style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top + scale(8) }]}>
          {view.download ? (
            <Pressable
              onPress={download}
              disabled={saving}
              style={[styles.downloadBtn, saving && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Download PDF"
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.onFill} />
              ) : (
                <Ionicons name="download-outline" size={scale(16)} color={colors.onFill} />
              )}
              <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.downloadText}>
                {saving ? "Saving…" : "Download PDF"}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={scale(24)} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + scale(28) }]}>
          <View style={styles.titleRow}>
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.title}>
              {view.title}
            </Text>
            {!!view.badge && (
              <View style={styles.badge}>
                <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.badgeText}>
                  {view.badge}
                </Text>
              </View>
            )}
          </View>
          {!!view.subtitle && (
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.subtitle}>
              {view.subtitle}
            </Text>
          )}

          {fields.length > 0 && (
            <View style={styles.card}>
              {fields.map((f, i) => (
                <View key={f.label} style={[styles.field, i === fields.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.fieldLabel}>
                    {f.label}
                  </Text>
                  <Text maxFontSizeMultiplier={FONT_SCALE_CAP} style={styles.fieldValue}>
                    {f.value}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {!!view.body && (
            // selectable, so a policy clause or a project brief can be copied
            // out — which is the reason someone opens one on a phone at all.
            <Text maxFontSizeMultiplier={FONT_SCALE_CAP} selectable style={styles.body}>
              {view.body}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: scale(18),
    paddingBottom: scale(6),
  },
  downloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: scale(6),
    backgroundColor: colors.brand,
    paddingHorizontal: scale(12),
    paddingVertical: scale(7),
    borderRadius: scale(999),
  },
  downloadText: { color: colors.onFill, fontWeight: "700", fontSize: scale(13) },
  content: { paddingHorizontal: scale(20), gap: scale(14) },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: scale(10), flexWrap: "wrap" },
  title: { flex: 1, fontSize: scale(22), fontWeight: "700", color: colors.text, lineHeight: scale(28) },
  badge: {
    marginTop: scale(4),
    paddingHorizontal: scale(9),
    paddingVertical: scale(3),
    borderRadius: scale(999),
    backgroundColor: colors.subtle,
  },
  badgeText: { fontSize: scale(11), fontWeight: "600", color: colors.subtleText, textTransform: "capitalize" },
  subtitle: { fontSize: scale(13), color: colors.muted, marginTop: -scale(6) },
  card: {
    backgroundColor: colors.card,
    borderRadius: scale(14),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: scale(14),
  },
  field: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: scale(12),
    paddingVertical: scale(11),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: { fontSize: scale(13), color: colors.muted, flexShrink: 0 },
  fieldValue: { flex: 1, textAlign: "right", fontSize: scale(14), fontWeight: "600", color: colors.text },
  body: { fontSize: scale(15), lineHeight: scale(24), color: colors.text },
})
