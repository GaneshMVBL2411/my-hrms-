/**
 * Shown instead of the app when the Supabase environment variables are absent.
 * Deliberately styled with inline CSS and no imports beyond React: it has to
 * render even if nothing else in the app can start.
 */
export function SetupRequired() {
  const code: React.CSSProperties = {
    display: "block",
    background: "#f4f4f5",
    border: "1px solid #e4e4e7",
    borderRadius: 6,
    padding: "10px 12px",
    margin: "8px 0 16px",
    font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#18181b",
    overflowX: "auto",
    whiteSpace: "pre",
  }

  return (
    <div
      style={{
        minHeight: "100svh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#fafafa",
        font: "15px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        color: "#3f3f46",
      }}
    >
      <div
        style={{
          maxWidth: 620,
          width: "100%",
          background: "#fff",
          border: "1px solid #e4e4e7",
          borderRadius: 8,
          padding: 32,
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 600, color: "#18181b" }}>
          The API server isn&rsquo;t configured
        </h1>
        <p style={{ margin: "0 0 20px" }}>
          This build has no <code>VITE_API_URL</code>, so it has nothing to connect to. That is the
          address of the HRMS API server, which holds the connection to the Neon database.
        </p>

        <h2 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#18181b" }}>On Vercel</h2>
        <p style={{ margin: "0 0 16px" }}>
          Add <code>VITE_API_URL</code> under <strong>Settings &rarr; Environment Variables</strong>, then
          redeploy. Vite reads it at build time, so an existing deployment will not pick it up until it is
          rebuilt.
        </p>

        <h2 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#18181b" }}>Locally</h2>
        <span style={code}>{"frontend/.env\n\nVITE_SUPABASE_URL=https://<ref>.supabase.co\nVITE_SUPABASE_ANON_KEY=<anon key>"}</span>

        <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
          The API server keeps the database credential; this value is only its address, so it is safe to
          expose. The Neon connection string must never be given to the browser.
        </p>
      </div>
    </div>
  )
}
