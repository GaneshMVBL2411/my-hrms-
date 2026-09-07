import { forwardRef } from "react"
import { useAuth } from "@/features/auth/AuthContext"
import { CompanyLogo } from "@/features/auth/CompanyLogo"

/**
 * The letterhead every generated document is printed on.
 *
 * Follows the Word templates in `Letterhead template design`: a logo and
 * company name at the top left, the reference and date at the top right, a
 * coloured rule beneath, the body, and a footer band with contact details.
 *
 * Everything that was a fixed colour is now the tenant's own, so a Prozonic
 * offer letter arrives in Prozonic teal and a Whhoohh Path one in green. Getting
 * this wrong is not a cosmetic problem — a letter is the most external thing
 * the HRMS produces, and it goes out under the customer's name.
 */

const SERIF = "Georgia, 'Times New Roman', serif"

/** The platform's own palette, used when a company has set no colours. */
const FALLBACK_PRIMARY = "#0f4c34"
const FALLBACK_ACCENT = "#c0912a"

export const PrintDocument = forwardRef<
  HTMLDivElement,
  {
    companyName: string
    companyAddress?: string | null
    refLine?: string
    children: React.ReactNode
  }
>(function PrintDocument({ companyName, companyAddress, refLine, children }, ref) {
  const { user } = useAuth()

  const primary = user?.primaryColor ?? FALLBACK_PRIMARY
  const accent = user?.accentColor ?? FALLBACK_ACCENT

  // Derived from the address rather than hard-coded, so the footer of a second
  // company's letter does not carry the first company's contact details.
  const domain = (user?.email ?? "").split("@")[1] ?? null
  const contactEmail = user?.companyCode ? `hr@${domain ?? "company.com"}` : null

  return (
    <div ref={ref} className="flex flex-col bg-white print:min-h-[100vh]">
      <header className="flex items-start justify-between gap-4 px-8 pt-5 pb-2">
        <div className="flex items-center gap-3">
          <CompanyLogo className="size-9 object-contain" />
          <div>
            <p className="text-lg font-bold tracking-wide" style={{ fontFamily: SERIF, color: primary }}>
              {companyName.toUpperCase()}
            </p>
            {companyAddress && <p className="text-[11px] text-[#6e7679]">{companyAddress}</p>}
          </div>
        </div>
        {refLine && <p className="whitespace-nowrap pt-1 text-[11px] text-[#6e7679]">{refLine}</p>}
      </header>

      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(to right, ${primary}, ${accent}, ${primary})` }}
      />

      <div className="flex-1 px-8 py-4">{children}</div>

      <footer
        className="flex items-center justify-center gap-2 px-8 py-2 text-[11px] text-white"
        style={{ background: primary }}
      >
        <span>{contactEmail ?? "—"}</span>
        {domain && (
          <>
            <span style={{ color: accent }}>·</span>
            <span>www.{domain}</span>
          </>
        )}
      </footer>
    </div>
  )
})
