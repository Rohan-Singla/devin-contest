/**
 * Example page — copy this shape when adding pages.
 */
import { useEffect, useState } from 'react'
import { api } from '../api.js'

export const route = '/'
export const title = 'Home'

export default function Home() {
  const [modules, setModules] = useState([])

  useEffect(() => {
    api('/api/_routes')
      .then(setModules)
      .catch(() => setModules([]))
  }, [])

  const endpoints = modules.flatMap((m) => m.endpoints.map((e) => ({ ...e, source: m.source })))

  return (
    <div className="stack">
      <h1>Your app is running</h1>
      <p className="muted">
        Agents add API routes to <code>server/routes/</code> and pages to{' '}
        <code>web/src/pages/</code>. Both are auto-discovered, so nothing shared gets edited.
      </p>

      <section>
        <h2>Live API endpoints</h2>
        {endpoints.length === 0 ? (
          <p className="muted">No endpoints yet.</p>
        ) : (
          <ul className="routes">
            {endpoints.map((e) => (
              <li key={e.method + e.path}>
                <span className="method">{e.method}</span>
                <code>{e.path}</code>
                <span className="muted">{e.source}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
