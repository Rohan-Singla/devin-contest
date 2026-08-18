/**
 * In-memory data store. No database, no dependencies — the point of this project
 * is the agents, not the persistence layer.
 *
 * Each collection is independent, so two agents adding two collections never
 * touch the same lines.
 */

const collections = new Map()

/**
 * Get (or lazily create) a named collection.
 * @param {string} name
 * @param {Array} seed  initial rows, used only on first access
 */
export function collection(name, seed = []) {
  if (!collections.has(name)) {
    collections.set(name, seed.map((row, i) => ({ id: row.id ?? String(i + 1), ...row })))
  }
  return {
    all: () => [...collections.get(name)],
    find: (id) => collections.get(name).find((r) => String(r.id) === String(id)) ?? null,
    insert: (row) => {
      const rows = collections.get(name)
      const created = { id: row.id ?? String(Date.now() + rows.length), ...row }
      rows.push(created)
      return created
    },
    update: (id, patch) => {
      const rows = collections.get(name)
      const i = rows.findIndex((r) => String(r.id) === String(id))
      if (i === -1) return null
      rows[i] = { ...rows[i], ...patch }
      return rows[i]
    },
    remove: (id) => {
      const rows = collections.get(name)
      const i = rows.findIndex((r) => String(r.id) === String(id))
      if (i === -1) return false
      rows.splice(i, 1)
      return true
    },
  }
}

/** Test helper — wipe everything between test files. */
export function resetStore() {
  collections.clear()
}
