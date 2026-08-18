# Conventions for agents working in this repository

Several agents work on this codebase **at the same time**, on separate branches that are merged
back automatically. These rules exist so that parallel work does not collide. Follow them exactly.

## The core rule: add files, do not edit shared ones

- **New API endpoint** → create `server/routes/<feature>.js`. It is auto-discovered. Never edit
  `server/index.js`.
- **New page** → create `web/src/pages/<Name>.jsx`. It is auto-discovered. Never edit
  `web/src/App.jsx`.
- **New data** → call `collection('<name>', seed)` from `server/store.js`. Never edit `store.js`.

If you believe you must edit a shared file, you are almost certainly solving it the wrong way.

## Never edit these files

```
server/index.js      web/src/App.jsx      web/src/main.jsx
package.json         web/package.json     web/vite.config.js
```

If your work needs a new npm dependency, **do not install it and do not edit package.json**. State
the package name in your final summary; the orchestrator applies dependencies centrally.

## Stay inside your assigned paths

Your issue names the paths you own. Do not create or modify files outside them — another agent is
working there right now, and your change will be discarded at merge time.

## Route module shape

```js
import { Router } from 'express'
export const basePath = '/api/products'
const router = Router()
router.get('/', (req, res) => res.json(products.all()))
export default router
```

## Page module shape

```jsx
export const route = '/products'
export const title = 'Products'
export default function Products() { return <div /> }
```

## Before you finish

Run `npm test` and make sure it passes. Add tests for what you built in `test/<feature>.test.js` —
one file per feature, never appended to another agent's test file.
