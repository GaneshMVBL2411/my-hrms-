import { forwardRef } from "react"
import logoMark from "@/assets/logo-mark.png"

const SERIF = "Georgia, 'Times New Roman', serif"

export const PrintDocument = forwardRef<
  HTMLDivElement,
  {
    companyName: string
    companyAddress?: string | null
    refLine?: string
    children: React.ReactNode
  }
>(function PrintDocument({ companyName, companyAddress, refLine, children }, ref) {
  return (
    <div ref={ref} className="flex flex-col bg-white print:min-h-[100vh]">
      <header className="flex items-start justify-between gap-4 px-8 pt-5 pb-2">
        <div className="flex items-center gap-3">
          <img src={logoMark} alt="" className="size-9 object-contain" />
          <div>
            <p
              className="text-lg font-bold tracking-wide text-[#0f4c34]"
              style={{ fontFamily: SERIF }}
            >
              {companyName.toUpperCase()}
            </p>
            {companyAddress && <p className="text-[11px] text-[#6e7679]">{companyAddress}</p>}
          </div>
        </div>
        {refLine && <p className="whitespace-nowrap pt-1 text-[11px] text-[#6e7679]">{refLine}</p>}
      </header>

      <div className="h-[3px] bg-gradient-to-r from-[#0f4c34] via-[#c0912a] to-[#0f4c34]" />

      <div className="flex-1 px-8 py-4">{children}</div>

      <footer className="flex items-center justify-center gap-2 bg-[#0f4c34] px-8 py-2 text-[11px] text-white">
        <span>hr@whhoohhpath.com</span>
        <span className="text-[#cbb77e]">·</span>
        <span>www.whhoohhpath.com</span>
      </footer>
    </div>
  )
})
