/**
 * Express API server.
 *
 * Routers are AUTO-DISCOVERED from server/routes/*.js — adding an endpoint means
 * adding a file, never editing this one. That is deliberate: several agents work
 * on this codebase in parallel, and shared files are where merge conflicts live.
 */
import express from 'express'
import cors from 'cors'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 3001

/**
 * Load every route module in server/routes/.
 * Each module default-exports an Express Router and may export `basePath`.
 */
export async function loadRoutes() {
  const dir = join(__dirname, 'routes')
  let files = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.js'))
  } catch {
    return []
  }

  const mounted = []
  for (const file of files.sort()) {
    const mod = await import(join(dir, file))
    if (!mod.default) continue
    mounted.push({
      basePath: mod.basePath ?? `/api/${file.replace('.js', '')}`,
      router: mod.default,
      source: file,
    })
  }
  return mounted
}

export async function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  const routes = await loadRoutes()
  for (const { basePath, router } of routes) {
    app.use(basePath, router)
  }

  // Introspection endpoint — the template's home page renders this.
  app.get('/api/_routes', (_req, res) => {
    res.json(
      routes.map(({ basePath, source, router }) => ({
        basePath,
        source,
        endpoints: (router.stack ?? [])
          .filter((l) => l.route)
          .map((l) => ({
            method: Object.keys(l.route.methods)[0].toUpperCase(),
            path: basePath + (l.route.path === '/' ? '' : l.route.path),
          })),
      }))
    )
  })

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  app.use((err, _req, res, _next) => {
    console.error(err)
    res.status(err.status ?? 500).json({ error: err.message })
  })

  return app
}

// Only listen when run directly, so tests can import the app without binding a port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp()
  app.listen(PORT, () => console.log(`api listening on http://localhost:${PORT}`))
}
