import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp, loadRoutes } from '../server/index.js'

test('app boots and routes load', async () => {
  const routes = await loadRoutes()
  assert.ok(Array.isArray(routes))
})

test('health endpoint responds', async () => {
  const app = await createApp()
  const res = await request(app).get('/api/health')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { ok: true })
})

test('unknown routes return 404 json', async () => {
  const app = await createApp()
  const res = await request(app).get('/api/does-not-exist')
  assert.equal(res.status, 404)
  assert.ok(res.body.error)
})

test('every route module mounts under /api/', async () => {
  for (const route of await loadRoutes()) {
    assert.ok(
      route.basePath.startsWith('/api/'),
      `${route.source} mounts at ${route.basePath}, which must start with /api/`
    )
    assert.equal(typeof route.router, 'function', `${route.source} must default-export a Router`)
  }
})
