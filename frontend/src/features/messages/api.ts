import { supabase } from "@/lib/supabase"
import { unwrap, unwrapVoid } from "@/lib/errors"
import type { Message, MessageThread } from "@/features/messages/types"

const COLUMNS =
  "id, sender_id, sender_name, recipient_id, recipient_name, body, read_at, created_at, edited_at, deleted_at"

export interface Contact {
  userId: number
  name: string
  role: string
  designation: string
  department: string
}

/** Everyone else in the company — who a new conversation can be started with. */
export async function listContacts(): Promise<Contact[]> {
  return unwrap<Contact[]>(await supabase.rpc("message_contacts"))
}

/** The inbox: one row per person, most recently active first. */
export async function listThreads(): Promise<MessageThread[]> {
  return unwrap<MessageThread[]>(await supabase.rpc("message_threads"))
}

/**
 * One conversation, oldest first.
 *
 * Both directions are fetched with an `or`, and row level security does the
 * rest: it already limits every row to messages the caller sent or received, so
 * this filter only has to pick which of those conversations to show. It cannot
 * widen what is visible — asking for someone else's thread returns nothing
 * rather than someone else's messages.
 */
export async function listMessages(withUserId: number): Promise<Message[]> {
  return unwrap<Message[]>(
    await supabase
      .from("message_detail")
      .select(COLUMNS)
      .or(`sender_id.eq.${withUserId},recipient_id.eq.${withUserId}`)
      .order("created_at", { ascending: true })
  )
}

export async function sendMessage(recipientId: number, body: string): Promise<void> {
  // sender_id and company_id are not sent: the insert policy requires them to
  // equal the session's own, and the database fills them from defaults, so
  // there is nothing here a caller could lie about.
  unwrapVoid(
    await supabase.from("messages").insert({ recipient_id: recipientId, body: body.trim() })
  )
}

/**
 * Mark everything received from this person as read.
 *
 * Only `read_at` is granted as an update, and only to the recipient, so this is
 * the one change either side can make to a message after it is sent.
 */
export async function markThreadRead(withUserId: number): Promise<void> {
  unwrapVoid(
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("sender_id", withUserId)
      .is("read_at", null)
  )
}
