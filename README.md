# mini-devin

Describe an application in one sentence. A planner breaks it into issues, several agents build them
**in parallel** inside separate cloud sandboxes, and every merge is verified against the test suite
before it lands — while a live preview of the running app updates beside the work.

It also works on repositories that already exist: file an issue, an agent picks it up.

```
                      ┌──────────────┐
   "build a store" ─► │   planner    │ ─► issues, grouped into waves
                      └──────────────┘     each owning disjoint files
                                                    │
              ┌─────────────────────────────────────┼───────────────────┐
              ▼                                     ▼                   ▼
        ┌───────────┐                         ┌───────────┐       ┌───────────┐
        │  agent 1  │  Pi runtime             │  agent 2  │       │  agent 3  │
        │  sandbox  │  + E2B-backed tools     │  sandbox  │       │  sandbox  │
        └─────┬─────┘                         └─────┬─────┘       └─────┬─────┘
              └──────────────── patches ────────────┴───────────────────┘
                                    │
                            ┌───────▼────────┐   one at a time
                            │  merge queue   │   rebase → verify → merge
                            └───────┬────────┘
                                    ▼
                        ┌──────────────────────┐
                        │  preview sandbox     │  runs the app AND
                        │  live URL + verifier │  gates every merge
                        └──────────────────────┘
```

## Setup

```bash
bun install
cp .env.example .env      # DEEPSEEK_API_KEY and E2B_API_KEY
bun run smoke             # verify every external boundary before spending tokens
bun run dev               # orchestrator on :4000, dashboard on :3000
```

Open <http://localhost:3000> and describe an app.

> On macOS, port 5000 is taken by AirPlay Receiver, which is why the dashboard uses 3000.

## How the parallelism actually works

Running several agents on one repository normally produces merge conflicts rather than speed. Four
layers keep that from happening, in order of how much they buy:

**1. The codebase is shaped so features do not share files.** The generated app auto-discovers
`server/routes/*.js` and `web/src/pages/*.jsx`. Adding an endpoint or a page means *adding a file* —
`server/index.js` and `App.jsx` are never edited. Most conflicts are impossible by construction, not
merely unlikely.

**2. The planner assigns disjoint paths.** Every issue names the files it owns, and `deconflict()`
enforces it: if two issues in a wave claim the same path, the later one is pushed to the next wave.
A plan that merges cleanly beats a plan that is maximally parallel.

**3. Contended files are quarantined.** Agents may not touch `package.json`. An agent that needs a
package names it in its summary, and the orchestrator applies it centrally — `package.json` is the
single most contended file in any parallel build.

**4. Merges are serial and verified.** Agents run concurrently; merges happen one at a time. Each
one applies to a branch, merges to `main`, and then runs the full suite **in the preview sandbox**.
Red tests mean the merge is reverted and the issue is marked failed. Nothing lands unverified.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Agent runtime | **Pi** (`@earendil-works/pi-coding-agent`) | Real agent loop, tool calling, context compaction, session history — none of it hand-rolled |
| Agent tools | Pi's built-ins, **rewired to E2B** | Pi exposes an `operations` seam on every file/shell tool for remote delegation; `src/worker/e2b-ops.ts` implements it against a sandbox |
| Model | **DeepSeek V4 Pro** | 1M context, tool use with thinking enabled, and cache hits priced ~30× under misses |
| Sandboxes | **E2B** | One disposable VM per agent, one long-lived VM per project preview |
| API | **Hono** on Bun | Shares one `Bun.serve` with the native WebSocket feed — the reason it is not Express |
| Data | **bun:sqlite** | Six tables, no ORM |
| Git | **simple-git** | Branch, apply, merge with real errors instead of parsed stdout |
| Dashboard | **Next.js + shadcn/ui** | |

## Layout

Six files carry the whole system:

| File | Responsibility |
|---|---|
| `src/orchestrator/planner.ts` | prompt → issues that own disjoint files, grouped into waves |
| `src/orchestrator/worker.ts` | one agent, one issue — Pi driving an E2B sandbox |
| `src/worker/e2b-ops.ts` | Pi's tools rewired to run inside the sandbox |
| `src/orchestrator/dispatcher.ts` | waves, the agent slot pool, the serial merge queue |
| `src/orchestrator/preview.ts` | the live app, and the verifier the merge queue trusts |
| `templates/base/AGENTS.md` | the conventions that stop agents colliding |

Supporting cast: `platform/` (sqlite, git, event bus), `server.ts` (Hono + WebSocket),
`llm.ts` (DeepSeek client, planner only), `sandbox.ts` (E2B wrapper), `web/` (Next.js dashboard).

## Working on an existing codebase

The greenfield path is a special case of the issue path — "build me a store" is just *issues against
an empty repo*. To work on a repository that already exists, open it and file an issue; an agent
picks it up, works it in a sandbox, and it goes through the same merge queue.

## Verified

An end-to-end run of *"Build an ecommerce website with a React frontend and a Node backend. Product
catalog, product detail page, and a shopping cart."*:

- 6 issues planned across 2 waves — 3 concurrent agents in wave 0
- **6/6 merged**, every merge test-verified, zero conflicts
- Live preview served the built store, `GET /api/products` returning real seeded data

```bash
bun run smoke      # every external boundary, ~40s — run this before a demo
bun test           # unit tests, offline
bunx tsc --noEmit
bun run status <projectId>   # inspect a run from the terminal
```

## Known gaps

- A crash loses in-flight runs — agent state lives in memory. On boot the orchestrator reconciles
  the database against that reality, but the work itself is gone. BullMQ + Redis is the fix.
- Failed issues are not retried automatically; re-run them from the board.
- Hand-filed issues declare no owned paths, so they bypass planner conflict-avoidance. The merge
  queue still catches collisions — the issue fails rather than corrupting `main`.
- No auth, single user, one process.
