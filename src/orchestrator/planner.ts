/**
 * Turns a one-line product prompt into a dependency-ordered issue plan.
 *
 * The plan's job is not just "what to build" — it is to carve the work so that
 * agents in the same wave touch disjoint files. Waves are the concurrency unit:
 * everything in wave N may run in parallel, and wave N+1 starts only once N is
 * merged.
 */
import { complete, makeClient, MODELS } from '../llm'

export interface PlannedIssue {
  title: string
  body: string
  wave: number
  paths: string[]
  dependencies: string[]
}

const SHARED_FILES = [
  'server/index.js',
  'web/src/App.jsx',
  'web/src/main.jsx',
  'package.json',
  'web/package.json',
  'web/vite.config.js',
]

const PLANNER_PROMPT = `You plan work for a team of autonomous coding agents building a web app.

The project already exists and already runs. It is an Express + React app with two conventions
that matter enormously to you:

- A new API endpoint is a NEW FILE at server/routes/<feature>.js — auto-discovered, nothing else edited.
- A new page is a NEW FILE at web/src/pages/<Name>.jsx — auto-discovered, nothing else edited.
- Shared data lives behind collection('<name>') from server/store.js.

These files are NEVER edited by anyone: ${SHARED_FILES.join(', ')}.

Your job: break the request into issues that agents can execute IN PARALLEL without collisions.

Rules for a good plan:
1. Every issue owns a disjoint set of file paths. Two issues in the same wave must never name the
   same file. This is the single most important rule.
2. An issue is one vertical slice — typically one API route file, one page file, and one test file.
3. Use waves for real dependencies only. Issues that need something from an earlier issue go in a
   later wave. Independent features belong in the SAME wave so they run concurrently.
4. Aim for 5-7 issues across 2-3 waves. Wave 0 should have at least 3 independent issues.
5. Each issue body is a clear spec: what to build, the exact endpoint or route, the data shape,
   and what "done" looks like. Write it for someone who cannot ask questions.

Reply with ONLY a JSON object, no prose and no code fences:

{
  "name": "short project name",
  "issues": [
    {
      "title": "Product catalog API",
      "body": "Add GET /api/products returning ... Each product has id, name, price, imageUrl. Seed 8 products. Add tests covering ...",
      "wave": 0,
      "paths": ["server/routes/products.js", "test/products.test.js"],
      "dependencies": []
    }
  ]
}

"dependencies" lists npm package names the issue needs (usually empty — prefer no new packages).`

export interface Plan {
  name: string
  issues: PlannedIssue[]
}

export async function planProject(prompt: string): Promise<Plan> {
  const client = makeClient()
  const response = await complete(client, {
    model: MODELS.pro,
    tools: false,
    json: true,
    reasoningEffort: 'medium',
    // A 6-issue plan with real specs runs long; truncation here is a hard failure,
    // so give it far more room than it should need.
    maxTokens: 32_000,
    messages: [
      { role: 'system', content: PLANNER_PROMPT },
      { role: 'user', content: prompt },
    ],
  })

  const choice = response.choices[0]
  if (choice?.finish_reason === 'length') {
    throw new Error('planner output was truncated — raise maxTokens')
  }

  const plan = parsePlan(choice?.message.content ?? '')
  return { name: plan.name, issues: deconflict(plan.issues) }
}

function parsePlan(raw: string): Plan {
  // Models sometimes wrap JSON in fences despite instructions.
  const cleaned = raw.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error(`planner returned no JSON:\n${raw.slice(0, 400)}`)

  let parsed: any
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch (err: any) {
    throw new Error(`planner returned invalid JSON: ${err.message}`)
  }

  if (!Array.isArray(parsed.issues) || parsed.issues.length === 0) {
    throw new Error('planner returned no issues')
  }

  return {
    name: String(parsed.name ?? 'Untitled project'),
    issues: parsed.issues.map((i: any, index: number) => ({
      title: String(i.title ?? `Issue ${index + 1}`),
      body: String(i.body ?? ''),
      wave: Number.isFinite(i.wave) ? Math.max(0, Math.floor(i.wave)) : 0,
      paths: Array.isArray(i.paths) ? i.paths.map(String) : [],
      dependencies: Array.isArray(i.dependencies) ? i.dependencies.map(String) : [],
    })),
  }
}

/**
 * Enforce rule 1 even when the model breaks it: if two issues in a wave claim
 * the same path, push the later one into a subsequent wave. A plan that merges
 * cleanly matters more than a plan that is maximally parallel.
 */
export function deconflict(issues: PlannedIssue[]): PlannedIssue[] {
  const result = issues.map((i) => ({ ...i }))
  result.sort((a, b) => a.wave - b.wave)

  const claimed = new Map<number, Set<string>>()

  for (const issue of result) {
    // Never let an agent claim a file the whole system depends on.
    issue.paths = issue.paths.filter((p) => !SHARED_FILES.includes(p))

    let wave = issue.wave
    for (;;) {
      const taken = claimed.get(wave) ?? new Set<string>()
      const collides = issue.paths.some((p) => taken.has(p))
      if (!collides) {
        issue.paths.forEach((p) => taken.add(p))
        claimed.set(wave, taken)
        issue.wave = wave
        break
      }
      wave++
    }
  }

  // Close gaps so waves are 0,1,2… with no empty ones.
  const waves = [...new Set(result.map((i) => i.wave))].sort((a, b) => a - b)
  const remap = new Map(waves.map((w, index) => [w, index]))
  for (const issue of result) issue.wave = remap.get(issue.wave)!

  return result.sort((a, b) => a.wave - b.wave)
}
