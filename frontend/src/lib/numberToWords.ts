const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
]

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
]

function threeDigitsToWords(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`)
    n %= 100
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)])
    n %= 10
    if (n > 0) parts.push(ONES[n])
  } else if (n > 0) {
    parts.push(ONES[n])
  }
  return parts.join(" ")
}

/** Converts a non-negative amount to words using the Indian numbering system (lakhs/crores). */
export function numberToIndianWords(amount: number): string {
  const rupees = Math.round(amount)
  if (rupees === 0) return "Zero"

  const crore = Math.floor(rupees / 10000000)
  const lakh = Math.floor((rupees % 10000000) / 100000)
  const thousand = Math.floor((rupees % 100000) / 1000)
  const hundred = rupees % 1000

  const segments: string[] = []
  if (crore > 0) segments.push(`${threeDigitsToWords(crore)} Crore`)
  if (lakh > 0) segments.push(`${threeDigitsToWords(lakh)} Lakh`)
  if (thousand > 0) segments.push(`${threeDigitsToWords(thousand)} Thousand`)
  if (hundred > 0) segments.push(threeDigitsToWords(hundred))

  return segments.join(" ")
}

export function rupeesInWords(amount: number): string {
  return `Rupees ${numberToIndianWords(amount)} Only`
}
