/**
 * Splits a SQL file into individual statements.
 *
 * Naive splitting on ";" breaks this schema badly: function bodies are wrapped
 * in dollar quotes ($$ … $$) and are full of semicolons, so a plain split would
 * cut them into fragments. This tracks dollar-quoted regions (including tagged
 * ones like $tag$) and single-quoted strings, and only breaks on a semicolon
 * that is genuinely at the top level.
 *
 * Exists so a failure can be attributed to one statement instead of "somewhere
 * in 4,484 lines".
 */
export function splitStatements(sql: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  let buf = ""
  let line = 1
  let startLine = 1
  let i = 0
  let dollarTag: string | null = null
  let inSingle = false
  let inLineComment = false
  let inBlockComment = false

  while (i < sql.length) {
    const ch = sql[i]!
    const rest = sql.slice(i)

    if (ch === "\n") line++

    if (inLineComment) {
      buf += ch
      if (ch === "\n") inLineComment = false
      i++
      continue
    }

    if (inBlockComment) {
      buf += ch
      if (rest.startsWith("*/")) {
        buf += sql[i + 1]
        i += 2
        inBlockComment = false
        continue
      }
      i++
      continue
    }

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
      buf += ch
      i++
      continue
    }

    if (inSingle) {
      buf += ch
      // '' is an escaped quote inside a string, not the end of one.
      if (ch === "'" && sql[i + 1] === "'") {
        buf += "'"
        i += 2
        continue
      }
      if (ch === "'") inSingle = false
      i++
      continue
    }

    if (rest.startsWith("--")) {
      inLineComment = true
      buf += ch
      i++
      continue
    }
    if (rest.startsWith("/*")) {
      inBlockComment = true
      buf += ch
      i++
      continue
    }

    const dollar = /^\$[A-Za-z_]*\$/.exec(rest)
    if (dollar) {
      dollarTag = dollar[0]
      buf += dollarTag
      i += dollarTag.length
      continue
    }

    if (ch === "'") {
      inSingle = true
      buf += ch
      i++
      continue
    }

    if (ch === ";") {
      const text = buf.trim()
      if (text && !/^(--|\/\*)/.test(text.replace(/\s/g, "").slice(0, 2))) {
        out.push({ text: text + ";", line: startLine })
      } else if (text) {
        out.push({ text: text + ";", line: startLine })
      }
      buf = ""
      i++
      startLine = line
      continue
    }

    buf += ch
    i++
  }

  const tail = buf.trim()
  if (tail) out.push({ text: tail, line: startLine })

  // Comment-only fragments are not statements; sending them wastes a round trip
  // and muddies the error reporting.
  return out.filter((s) => s.text.replace(/--[^\n]*\n?/g, "").trim().length > 0)
}
