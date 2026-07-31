import { supabase } from "@/lib/supabase"

/** PostgREST rows are 0-indexed and inclusive; the UI pages from 1. */
export function pageRange(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize
  return [from, from + pageSize - 1]
}

/**
 * Builds an `ilike` pattern. Commas, parentheses and quotes are separators in
 * PostgREST's filter grammar, so a search box containing them would otherwise
 * produce a malformed query rather than no results.
 */
export function likePattern(search: string): string {
  return `%${search.replace(/[,()"\\.]/g, " ").trim()}%`
}

/** Best-effort audit trail; a failed log must never fail the action it describes. */
export function logAudit(action: string, entity: string, entityId?: number | null): void {
  void supabase.from("audit_logs").insert({ action, entity, entity_id: entityId ?? null })
}
