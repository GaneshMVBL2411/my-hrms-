import { readFileSync, existsSync } from "node:fs"

/**
 * Loads server/.env into process.env.
 *
 * Must be the first import in index.ts. ES modules evaluate their dependencies
 * in declaration order, so importing this before db.ts and auth.ts is what
 * guarantees DATABASE_URL and JWT_SECRET exist by the time those modules run
 * their top-level checks — both throw on startup if they are missing, which is
 * deliberate but only useful if the file has actually been read first.
 *
 * The file wins over the ambient environment. This machine exports a
 * DATABASE_URL pointing at an unrelated local database, and deferring to it
 * meant a script silently talked to the wrong server — a mistake that is very
 * hard to see, because everything appears to work.
 *
 * Deliberately not dotenv: the parsing needed is a handful of lines, and one
 * fewer dependency in the path of "does the server start" is worth having.
 */
const path = new URL("../.env", import.meta.url)

if (existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const i = trimmed.indexOf("=")
    if (i <= 0) continue

    const key = trimmed.slice(0, i).trim()
    let value = trimmed.slice(i + 1).trim()

    // Strip one layer of surrounding quotes, which people add out of habit and
    // which would otherwise end up inside the connection string.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}
