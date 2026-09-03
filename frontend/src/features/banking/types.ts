export interface CompanyBankDetails {
  id: number
  companyName: string
  legalName: string | null

  bankName: string
  accountHolderName: string
  accountNumber: string
  ifscCode: string
  branchName: string | null
  swiftCode: string | null
  upiId: string | null

  gstNumber: string | null
  panNumber: string | null
  tanNumber: string | null
  pfRegistrationNumber: string | null
  esiRegistrationNumber: string | null

  authorizedSignatory: string | null
  logoUrl: string | null
  signatureUrl: string | null

  /** The payout account. Exactly one record can hold this at a time. */
  isPrimary: boolean
  status: "active" | "inactive"

  /** Cleared by any edit — a verified account means verified as it stands now. */
  verifiedByName: string | null
  verifiedAt: string | null
  updatedByName: string | null
  updatedAt: string
}

export interface CompanyBankUpsert {
  companyName: string
  legalName?: string
  bankName: string
  accountHolderName: string
  accountNumber: string
  ifscCode: string
  branchName?: string
  swiftCode?: string
  upiId?: string
  gstNumber?: string
  panNumber?: string
  tanNumber?: string
  pfRegistrationNumber?: string
  esiRegistrationNumber?: string
  authorizedSignatory?: string
  logoUrl?: string
  signatureUrl?: string
  isPrimary: boolean
  status: "active" | "inactive"
}
