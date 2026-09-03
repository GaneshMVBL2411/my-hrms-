/**
 * CSV export.
 *
 * Two separate escaping jobs happen here, and conflating them is how the second
 * one gets missed:
 *
 *   Quoting   makes the file parse correctly — RFC 4180 quoting of delimiters,
 *             quotes and newlines. This was always here.
 *   Defusing  makes the file safe to OPEN. A cell beginning = + - @ tab or CR is
 *             a formula to Excel, Sheets and LibreOffice, so a value an employee
 *             typed into their own name field executes on the machine of whoever
 *             exports it. That is HR's machine, which is the privileged one, and
 *             the export button is the delivery mechanism (CWE-1236).
 */

/** Leading characters a spreadsheet will treat as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * Values that merely look risky but are ordinary data, and must survive intact.
 *
 * A payroll export is full of negative numbers — every deduction is one — and
 * Indian phone numbers are written +91…. Prefixing those would corrupt real
 * data in every row to defuse an attack neither can carry: a spreadsheet reads
 * both as a literal, never as a formula. So the guard applies only to values
 * that are not plainly a number.
 */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** Phone numbers as this system stores them: +country, digits, spaces, dashes. */
const PHONE = /^\+\d[\d\s()-]{4,}$/

function defuse(str: string): string {
  if (!FORMULA_LEAD.test(str)) return str
  if (PLAIN_NUMBER.test(str) || PHONE.test(str)) return str
  // A leading apostrophe is the spreadsheet's own "this is text" marker. It is
  // consumed on open rather than displayed, so the cell still reads correctly.
  return `'${str}`
}

export function downloadCsv<T extends object>(filename: string, rows: T[]) {
  if (rows.length === 0) return

  const headers = Object.keys(rows[0]) as (keyof T)[]
  const escape = (value: unknown) => {
    // Defuse first, then quote — so the apostrophe ends up inside the quotes
    // rather than stranded outside them, where it would break the parse.
    const str = defuse(String(value ?? ""))
    return /["',\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n")

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
