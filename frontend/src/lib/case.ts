/**
 * Postgres columns are snake_case; the UI's types are camelCase. The retired
 * FastAPI layer converted between them with a Pydantic alias generator — these
 * do the same job now that queries go straight to PostgREST.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

const camelKey = (key: string) => key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
const snakeKey = (key: string) => key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)

function convert(value: unknown, mapKey: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => convert(item, mapKey))
  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [mapKey(key), convert(item, mapKey)])
  )
}

export function toCamel<T>(value: unknown): T {
  return convert(value, camelKey) as T
}

export function toSnake<T = Record<string, unknown>>(value: unknown): T {
  return convert(value, snakeKey) as T
}

/** Drops keys whose value is `undefined` so a partial update never nulls a column it didn't mention. */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}
