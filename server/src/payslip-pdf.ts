import PDFDocument from "pdfkit"
import type { PoolClient } from "pg"

/**
 * One payslip, as a PDF.
 *
 * Rendered here rather than in either client because the same file has to
 * reach three places: the download button on the web, the download button on
 * the phone, and the email that goes out when HR runs payroll. Three renderers
 * would be three payslips that disagree on a rounding, and the one in the
 * mailbox is the one that gets forwarded to a bank.
 *
 * pdfkit draws with the fourteen standard fonts, none of which has a rupee
 * glyph, so amounts are written "Rs." — the way a bank statement does.
 */

export interface PayslipRow {
  id: number
  employee_id: number
  employee_name: string
  employee_code: string
  designation_title: string | null
  department_name: string | null
  joining_date: string | null
  month: number
  year: number
  basic: string | number
  hra: string | number
  special_allowance: string | number
  gross_pay: string | number
  pf_deduction: string | number
  esi_deduction: string | number
  professional_tax: string | number
  net_pay: string | number
  generated_at: string | Date
}

export interface CompanyHeader {
  name: string
  code: string | null
  address: string | null
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "September 2026" — the period as it appears in the subject line and the file name. */
export function payslipPeriod(p: Pick<PayslipRow, "month" | "year">): string {
  return `${MONTHS[p.month - 1] ?? p.month} ${p.year}`
}

/** `Payslip_EMP001_September2026.pdf` — the same name the web download uses. */
export function payslipFilename(p: Pick<PayslipRow, "month" | "year" | "employee_code">): string {
  const code = (p.employee_code || "employee").replace(/[^A-Za-z0-9]+/g, "_")
  return `Payslip_${code}_${MONTHS[p.month - 1] ?? p.month}${p.year}.pdf`
}

/**
 * Reads the payslip and the letterhead under the caller's session.
 *
 * `payslip_detail` is security_invoker, so an employee gets their own rows and
 * nothing else; a missing row and a forbidden one both come back null, which
 * is the right answer to give a caller guessing ids.
 */
export async function loadPayslip(
  client: PoolClient,
  id: number
): Promise<{ payslip: PayslipRow; company: CompanyHeader } | null> {
  const { rows } = await client.query<PayslipRow>(
    `select id, employee_id, employee_name, employee_code, designation_title, department_name,
            joining_date, month, year, basic, hra, special_allowance, gross_pay,
            pf_deduction, esi_deduction, professional_tax, net_pay, generated_at
       from public.payslip_detail where id = $1`,
    [id]
  )
  const payslip = rows[0]
  if (!payslip) return null
  return { payslip, company: await loadCompanyHeader(client) }
}

export async function loadCompanyHeader(client: PoolClient): Promise<CompanyHeader> {
  // company_settings holds the name a founder chose to print; companies holds
  // the one they registered with. The first wins when it exists.
  const { rows } = await client.query<{ name: string; code: string | null; address: string | null }>(
    `select coalesce(cs.company_name, c.name) as name, c.code, cs.address
       from public.companies c
       left join public.company_settings cs on cs.company_id = c.id
      where c.id = public.app_company_id()
      limit 1`
  )
  return rows[0] ?? { name: "HRMS", code: null, address: null }
}

// ------------------------------------------------------------------ drawing

const INK = "#1f2937"
const MUTED = "#6e7679"
const BRAND = "#0f4c34"
const RULE = "#d9e3dd"
const TINT = "#f3f7f5"

function money(value: string | number): string {
  const n = Number(value) || 0
  return `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function date(value: string | Date | null): string {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export function renderPayslipPdf(payslip: PayslipRow, company: CompanyHeader): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: `Payslip ${payslipPeriod(payslip)} — ${payslip.employee_name}`, Author: company.name },
    })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    const left = doc.page.margins.left
    const width = doc.page.width - left - doc.page.margins.right
    const period = payslipPeriod(payslip)
    const ref = `${company.code ?? "HR"}/PAY/${payslip.year}/${String(payslip.id).padStart(3, "0")}`

    // Letterhead --------------------------------------------------------
    doc.font("Helvetica-Bold").fontSize(18).fillColor(BRAND).text(company.name, left, 48, { width: width * 0.65 })
    if (company.address) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(company.address, { width: width * 0.65 })
    }
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("PAYSLIP", left, 48, { width, align: "right" })
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(period, left, 66, { width, align: "right" })
    doc.fontSize(8).text(`Ref: ${ref}`, left, 80, { width, align: "right" })

    let y = Math.max(doc.y, 100) + 10
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor(BRAND).stroke()
    y += 16

    // Employee block: two columns of label/value pairs ------------------
    const cells: [string, string][] = [
      ["Employee name", payslip.employee_name],
      ["Employee code", payslip.employee_code],
      ["Designation", payslip.designation_title ?? "—"],
      ["Department", payslip.department_name ?? "—"],
      ["Date of joining", date(payslip.joining_date)],
      ["Generated on", date(payslip.generated_at)],
    ]
    const colW = width / 2
    const rowH = 20
    cells.forEach(([label, value], i) => {
      const cx = left + (i % 2) * colW
      const cy = y + Math.floor(i / 2) * rowH
      doc.rect(cx, cy, colW, rowH).lineWidth(0.5).strokeColor(RULE).stroke()
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(label, cx + 8, cy + 6, { width: colW * 0.45, lineBreak: false })
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(value, cx + colW * 0.45, cy + 6, {
        width: colW * 0.55 - 8, align: "right", lineBreak: false, ellipsis: true,
      })
    })
    y += rowH * Math.ceil(cells.length / 2) + 16

    // Earnings | Deductions table --------------------------------------
    const deductions = Number(payslip.pf_deduction) + Number(payslip.esi_deduction) + Number(payslip.professional_tax)
    const rows: [string, string, string, string][] = [
      ["Basic salary", money(payslip.basic), "Provident Fund", money(payslip.pf_deduction)],
      ["House Rent Allowance", money(payslip.hra), "ESIC", money(payslip.esi_deduction)],
      ["Special Allowance", money(payslip.special_allowance), "Professional Tax", money(payslip.professional_tax)],
      ["Gross Earnings", money(payslip.gross_pay), "Total Deductions", money(deductions)],
    ]
    const half = width / 2
    const amountW = 110

    doc.rect(left, y, width, rowH).fillColor(TINT).fill()
    doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND)
    doc.text("Earnings", left + 8, y + 6, { lineBreak: false })
    doc.text("Amount", left + half - amountW, y + 6, { width: amountW - 8, align: "right", lineBreak: false })
    doc.text("Deductions", left + half + 8, y + 6, { lineBreak: false })
    doc.text("Amount", left + width - amountW, y + 6, { width: amountW - 8, align: "right", lineBreak: false })
    y += rowH

    rows.forEach((r, i) => {
      const total = i === rows.length - 1
      if (total) doc.rect(left, y, width, rowH).fillColor("#f8faf9").fill()
      doc.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK)
      doc.text(r[0], left + 8, y + 6, { lineBreak: false })
      doc.text(r[1], left + half - amountW, y + 6, { width: amountW - 8, align: "right", lineBreak: false })
      doc.text(r[2], left + half + 8, y + 6, { lineBreak: false })
      doc.text(r[3], left + width - amountW, y + 6, { width: amountW - 8, align: "right", lineBreak: false })
      doc.moveTo(left, y + rowH).lineTo(left + width, y + rowH).lineWidth(0.5).strokeColor(RULE).stroke()
      y += rowH
    })
    doc.rect(left, y - rowH * (rows.length + 1), width, rowH * (rows.length + 1)).lineWidth(0.5).strokeColor(RULE).stroke()
    doc.moveTo(left + half, y - rowH * (rows.length + 1)).lineTo(left + half, y).stroke()
    y += 14

    // Net pay ------------------------------------------------------------
    doc.rect(left, y, width, 28).fillColor(BRAND).fill()
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff")
    doc.text("NET PAY", left + 12, y + 9, { lineBreak: false })
    doc.fontSize(12).text(money(payslip.net_pay), left, y + 8, { width: width - 12, align: "right", lineBreak: false })
    y += 36

    doc.font("Helvetica").fontSize(9).fillColor(INK)
      .text("Net pay in words: ", left, y, { continued: true })
      .font("Helvetica-Oblique").text(rupeesInWords(Number(payslip.net_pay)))
    y = doc.y + 14

    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(
      "This is a computer-generated statement of salary and does not require a signature. " +
        "This document is confidential and intended solely for the employee named above.",
      left, y, { width }
    )
    y = doc.y + 28

    doc.fontSize(8).fillColor(MUTED).text(`For ${company.name}`, left, y, { width, align: "right" })
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("Authorised Signatory", left, y + 26, { width, align: "right" })

    doc.end()
  })
}

// ------------------------------------------------------ amount in words

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
]
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

function threeDigits(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`)
    n %= 100
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]!)
    if (n % 10 > 0) parts.push(ONES[n % 10]!)
  } else if (n > 0) {
    parts.push(ONES[n]!)
  }
  return parts.join(" ")
}

/** Indian grouping — lakhs and crores — to match the web's numberToWords. */
export function rupeesInWords(amount: number): string {
  const rupees = Math.round(Math.abs(amount))
  if (rupees === 0) return "Rupees Zero Only"
  const segments: string[] = []
  const crore = Math.floor(rupees / 10_000_000)
  const lakh = Math.floor((rupees % 10_000_000) / 100_000)
  const thousand = Math.floor((rupees % 100_000) / 1000)
  const rest = rupees % 1000
  if (crore) segments.push(`${threeDigits(crore)} Crore`)
  if (lakh) segments.push(`${threeDigits(lakh)} Lakh`)
  if (thousand) segments.push(`${threeDigits(thousand)} Thousand`)
  if (rest) segments.push(threeDigits(rest))
  return `Rupees ${segments.join(" ")} Only`
}
