export interface Message {
  id: number
  senderId: number
  senderName: string
  recipientId: number
  recipientName: string
  body: string
  /** When the recipient opened it. Null means unread. */
  readAt: string | null
  createdAt: string
}

/** One row per person you have a conversation with — the inbox list. */
export interface MessageThread {
  userId: number
  name: string
  lastBody: string
  lastAt: string
  unread: number
}
