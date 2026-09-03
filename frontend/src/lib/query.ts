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

/** Best-effort audit trail; routes to server-side RPC to prevent table tampering or flooding. */
export function logAudit(action: string, entity: string, entityId?: number | null, meta?: Record<string, unknown>): void {
  void supabase.rpc("log_application_audit", {
    p_action: action,
    p_entity: entity,
    p_entity_id: entityId ?? null,
    p_meta: meta ?? null,
  })
}
