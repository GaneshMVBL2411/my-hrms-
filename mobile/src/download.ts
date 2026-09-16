import { Alert, Platform } from "react-native"
import * as Sharing from "expo-sharing"
// The legacy module on purpose: the SAF calls and string writes below have no
// counterpart in the new File/Directory API yet, and the app name printed in
// the iOS alert depends on the documents folder that module exposes.
import * as LegacyFS from "expo-file-system/legacy"
import * as SecureStore from "expo-secure-store"

/**
 * Saving a file "directly" — a letter, a payslip, an attendance workbook.
 *
 * "Directly" costs one prompt on Android and none after it, and that is a
 * platform limit rather than a choice. Under scoped storage an app cannot
 * write into a folder someone can find — Downloads, say — unless they have
 * named it once. The grant that comes back is persistable, so it is kept and
 * reused: the first download asks where, every download after it just saves.
 *
 * iOS has no such restriction on the app's own documents folder, and with
 * UIFileSharingEnabled declared that folder *is* the app's entry in Files.
 * So there the write is direct from the very first file.
 */

/**
 * Where this device has been told to put downloads.
 *
 * A Storage Access Framework grant is persistable, so it is worth keeping: it
 * is the difference between naming a folder once and naming it for every
 * file. Stored per-install rather than per-account, because it describes the
 * phone rather than the person. The key still says "letters" because that is
 * what it was called when phones first stored one, and a rename would make
 * every one of them ask again.
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
async function saveToChosenFolder(base64: string, name: string, mimeType: string): Promise<boolean> {
  const SAF = LegacyFS.StorageAccessFramework
  const write = async (directoryUri: string) => {
    const target = await SAF.createFileAsync(directoryUri, name, mimeType)
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

/** The two kinds of file this app hands over, and what each is called. */
export const PDF = { mimeType: "application/pdf", uti: "com.adobe.pdf" }
export const XLSX = {
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  uti: "org.openxmlformats.spreadsheetml.sheet",
}

/**
 * Saves a file, given its bytes as base64 and the name it should have.
 *
 * `fileUri` is an existing copy of the same bytes, if the caller has one (a
 * printed letter does). It is only used for the share sheet, which needs a
 * file and not a string; without one a copy is written to the cache first.
 *
 * Tells the person what happened in an alert either way, because a download
 * that silently succeeds is indistinguishable from one that silently failed.
 */
export async function saveFile(
  base64: string,
  name: string,
  kind: { mimeType: string; uti: string } = PDF,
  fileUri?: string
): Promise<void> {
  if (!base64) throw new Error("The file came back empty.")

  if (Platform.OS !== "android") {
    // Straight into the folder the Files app shows under this app's name.
    await LegacyFS.writeAsStringAsync(`${LegacyFS.documentDirectory}${name}`, base64, { encoding: "base64" })
    Alert.alert("Downloaded", `${name} is in Files, under Whhoohh Path HRMS.`)
    return
  }

  if (await saveToChosenFolder(base64, name, kind.mimeType)) {
    Alert.alert("Downloaded", `${name} has been saved.`)
    return
  }

  // Only reached if someone declines the one-time folder prompt. Handing
  // them the finished file is better than losing it over a dismissed dialog.
  if (!(await Sharing.isAvailableAsync())) return
  let uri = fileUri
  if (!uri) {
    uri = `${LegacyFS.cacheDirectory}${name}`
    await LegacyFS.writeAsStringAsync(uri, base64, { encoding: "base64" })
  }
  await Sharing.shareAsync(uri, { mimeType: kind.mimeType, UTI: kind.uti, dialogTitle: name })
}

/** The PDF case, which is most of them. */
export async function savePdf(base64: string, name: string, fileUri?: string): Promise<void> {
  return saveFile(base64, name, PDF, fileUri)
}

/** Base64 of a fetched body — for bytes that arrived over the network rather than from a printer. */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ""
  // In slices: String.fromCharCode(...view) blows the argument limit on
  // anything larger than a few tens of kilobytes.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return globalThis.btoa(binary)
}
