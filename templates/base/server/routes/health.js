/**
 * Example route module — copy this shape when adding endpoints.
 *
 * Default-export an Express Router. Optionally export `basePath` to control
 * where it mounts; it defaults to /api/<filename>.
 */
import { Router } from 'express'

export const basePath = '/api/health'

const router = Router()

router.get('/', (_req, res) => {
  res.json({ ok: true })
})

export default router
