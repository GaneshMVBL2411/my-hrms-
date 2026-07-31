export function downloadCsv<T extends object>(filename: string, rows: T[]) {
  if (rows.length === 0) return

  const headers = Object.keys(rows[0]) as (keyof T)[]
  const escape = (value: unknown) => {
    const str = String(value ?? "")
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
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
