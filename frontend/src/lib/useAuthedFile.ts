import { useEffect, useState } from "react"
import { fetchFileBlob } from "@/lib/supabase"

/**
 * A browser-usable URL for a file the API will only hand over with a token.
 *
 * `/files/:id` is behind requireAuth, and an `<img src>` cannot carry an
 * Authorization header — which is why the attendance selfie rendered as a
 * broken image. The obvious repair is to put the token in the query string,
 * and that is the one to avoid: a bearer token there ends up in access logs,
 * in browser history, and in the Referer sent to anything the page later
 * links to. It grants the whole API, so it should not be written down
 * anywhere a URL is written down.
 *
 * Fetching with the header and handing the element an object URL keeps the
 * token in memory where it already lives. The cost is that the bytes are held
 * by the page until it is revoked, which is why the cleanup below is not
 * optional: a table of thumbnails would otherwise leak one image per row for
 * as long as the tab is open.
 */
export function useAuthedFile(fileId: string | null | undefined): {
  url: string | null
  failed: boolean
} {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!fileId) {
      setUrl(null)
      setFailed(false)
      return
    }

    // Guards against a response arriving after the id has changed or the
    // component has gone: without it, a slow first request can overwrite the
    // URL of a second, and revoking on unmount would free a URL still in use.
    let live = true
    let created: string | null = null
    setFailed(false)

    fetchFileBlob(fileId)
      .then((blob) => {
        if (!live) return
        created = URL.createObjectURL(blob)
        setUrl(created)
      })
      .catch(() => {
        if (live) setFailed(true)
      })

    return () => {
      live = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileId])

  return { url, failed }
}
