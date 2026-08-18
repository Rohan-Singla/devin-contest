/**
 * Pages are AUTO-DISCOVERED from src/pages/*.jsx — adding a page means adding a
 * file, never editing this one. Each page module must export:
 *
 *   export const route = '/products'      // url path
 *   export const title = 'Products'       // nav label ('' hides it from the nav)
 *   export default function Products() {} // the component
 *
 * Keeping this file untouched is what lets several agents add pages in parallel
 * without colliding.
 */
import { useEffect, useState } from 'react'

const modules = import.meta.glob('./pages/*.jsx', { eager: true })

const pages = Object.entries(modules)
  .map(([file, mod]) => ({
    file,
    route: mod.route ?? '/' + file.split('/').pop().replace('.jsx', '').toLowerCase(),
    title: mod.title ?? '',
    Component: mod.default,
  }))
  .filter((p) => p.Component)
  .sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : a.route.localeCompare(b.route)))

function useHashRoute() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const onChange = () => setPath(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path
}

export default function App() {
  const path = useHashRoute()
  const active = pages.find((p) => p.route === path) ?? pages.find((p) => p.route === '/')

  return (
    <div className="app">
      <header>
        <a href="#/" className="brand">
          {import.meta.env.VITE_APP_NAME ?? 'Store'}
        </a>
        <nav>
          {pages
            .filter((p) => p.title)
            .map((p) => (
              <a key={p.route} href={`#${p.route}`} className={p.route === path ? 'active' : ''}>
                {p.title}
              </a>
            ))}
        </nav>
      </header>

      <main>
        {active ? (
          <active.Component />
        ) : (
          <div className="empty">
            <h1>Nothing here yet</h1>
            <p>
              No page is registered for <code>{path}</code>.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
