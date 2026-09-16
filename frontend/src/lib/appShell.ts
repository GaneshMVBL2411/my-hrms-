/**
 * The portal, when it is running inside the phone app rather than a browser.
 *
 * The app shows the portal in a WebView, and a WebView cannot save a file the
 * way a browser does: a blob URL handed to `<a download>` is ignored, without
 * an error. Every download in the portal appeared to succeed on a phone — the
 * toast said so — and produced nothing.
 *
 * So downloads are handed to the app instead. It fetches the file over its own
 * authenticated request and writes it to storage, which is the same path
 * letters and payslips already take there. Only the path is sent; the app
 * knows its own API address and its own token, and neither needs to travel
 * through the page.
 */

interface ReactNativeWebView {
  postMessage(message: string): void
}

function shell(): ReactNativeWebView | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { ReactNativeWebView?: ReactNativeWebView }).ReactNativeWebView ?? null
}

/** True when this page is the portal tab of the phone app. */
export function inAppShell(): boolean {
  return shell() !== null
}

/**
 * Asks the app to download a file, and says whether it did.
 *
 * `false` means there is no app to ask — an ordinary browser — and the caller
 * should do the download itself.
 */
export function requestAppDownload(path: string, filename: string): boolean {
  const target = shell()
  if (!target) return false
  target.postMessage(JSON.stringify({ type: "download", path, filename }))
  return true
}
