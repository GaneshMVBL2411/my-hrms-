export interface Message {
  id: number
  senderId: number
  senderName: string
  recipientId: number
  recipientName: string
  /** Null once withdrawn: the view stops returning the text, the row keeps it. */
  body: string | null
  /** When the recipient opened it. Null means unread. */
  readAt: string | null
  createdAt: string
  /** Set when the sender corrected it, within 15 minutes of sending. */
  editedAt: string | null
  /** Set when the sender withdrew it. The message keeps its place in the thread. */
  deletedAt: string | null
}

/** One row per person you have a conversation with — the inbox list. */
export interface MessageThread {
  userId: number
  name: string
  lastBody: string
  lastAt: string
  unread: number
  /** Null for someone who has never opened either client. */
  lastSeenAt: string | null
  isOnline: boolean
}
