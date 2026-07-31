import jsPDF from "jspdf"
import html2canvas from "html2canvas"

const A4_WIDTH_PT = 595.28
const A4_HEIGHT_PT = 841.89

// If content only slightly overflows one page (e.g. just a footer band spilling onto
// a near-empty second page), shrink it to fit a single page instead of paginating.
const SINGLE_PAGE_TOLERANCE = 1.25

/** Renders a DOM node to an A4 PDF and triggers a download. */
export async function downloadElementAsPdf(element: HTMLElement, filename: string) {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  })
  const imgData = canvas.toDataURL("image/png")

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" })
  const fullWidth = A4_WIDTH_PT
  const fullHeight = (canvas.height * fullWidth) / canvas.width

  if (fullHeight <= A4_HEIGHT_PT * SINGLE_PAGE_TOLERANCE) {
    const scale = Math.min(1, A4_HEIGHT_PT / fullHeight)
    const imgWidth = fullWidth * scale
    const imgHeight = fullHeight * scale
    const xOffset = (A4_WIDTH_PT - imgWidth) / 2
    pdf.addImage(imgData, "PNG", xOffset, 0, imgWidth, imgHeight)
  } else {
    let heightLeft = fullHeight
    let position = 0

    pdf.addImage(imgData, "PNG", 0, position, fullWidth, fullHeight)
    heightLeft -= A4_HEIGHT_PT

    while (heightLeft > 0) {
      position -= A4_HEIGHT_PT
      pdf.addPage()
      pdf.addImage(imgData, "PNG", 0, position, fullWidth, fullHeight)
      heightLeft -= A4_HEIGHT_PT
    }
  }

  pdf.save(filename)
}
