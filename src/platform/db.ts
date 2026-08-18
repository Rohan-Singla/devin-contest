/**
 * Persistence. SQLite via bun:sqlite — no ORM, no migration tool, six tables.
 *
 * Everything the UI shows is read from here, and every agent event is written
 * here before being broadcast, so a reconnecting client can replay state.
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type ProjectStatus = 'planning' | 'provisioning' | 'building' | 'ready' | 'failed'
export type IssueStatus = 'todo' | 'running' | 'merging' | 'merged' | 'failed' | 'blocked'

export interface Project {
  id: string
  name: string
  prompt: string
  repoPath: string
  status: ProjectStatus
  previewUrl: string | null
  sandboxId: string | null
  error: string | null
  createdAt: number
}

export interface Issue {
  id: string
  projectId: string
  number: number
  title: string
  body: string
  status: IssueStatus
  wave: number
  paths: string[]
  dependencies: string[]
  branch: string | null
  agentSlot: number | null
  summary: string | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface RunEvent {
  id: number
  projectId: string
  issueId: string | null
  ts: number
  type: string
  payload: unknown
}

const DB_PATH = process.env.DB_PATH ?? 'data/app.db'

mkdirSync(dirname(DB_PATH), { recursive: true })
export const db = new Database(DB_PATH, { create: true })

db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    repo_path   TEXT NOT NULL,
    status      TEXT NOT NULL,
    preview_url TEXT,
    sandbox_id  TEXT,
    error       TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issues (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id),
    number       INTEGER NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    status       TEXT NOT NULL,
    wave         INTEGER NOT NULL DEFAULT 0,
    paths        TEXT NOT NULL DEFAULT '[]',
    dependencies TEXT NOT NULL DEFAULT '[]',
    branch       TEXT,
    agent_slot   INTEGER,
    summary      TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    issue_id   TEXT,
    ts         INTEGER NOT NULL,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);
  CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, id);
`)

const id = () => crypto.randomUUID().slice(0, 8)

// ───────────────────────────────────────────────────────────── projects

function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    repoPath: r.repo_path,
    status: r.status,
    previewUrl: r.preview_url,
    sandboxId: r.sandbox_id,
    error: r.error,
    createdAt: r.created_at,
  }
}

export function createProject(name: string, prompt: string, repoPath: string): Project {
  const project: Project = {
    id: id(),
    name,
    prompt,
    repoPath,
    status: 'planning',
    previewUrl: null,
    sandboxId: null,
    error: null,
    createdAt: Date.now(),
  }
  db.query(
    `INSERT INTO projects (id, name, prompt, repo_path, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(project.id, project.name, project.prompt, project.repoPath, project.status, project.createdAt)
  return project
}

export function updateProject(projectId: string, patch: Partial<Project>): void {
  const columns: Record<string, string> = {
    status: 'status',
    previewUrl: 'preview_url',
    sandboxId: 'sandbox_id',
    error: 'error',
    name: 'name',
  }
  const sets: string[] = []
  const values: (string | number | null)[] = []
  for (const [key, column] of Object.entries(columns)) {
    if (key in patch) {
      sets.push(`${column} = ?`)
      values.push((patch as any)[key])
    }
  }
  if (!sets.length) return
  db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values, projectId)
}

export function getProject(projectId: string): Project | null {
  const row = db.query('SELECT * FROM projects WHERE id = ?').get(projectId)
  return row ? rowToProject(row) : null
}

export function listProjects(): Project[] {
  return db
    .query('SELECT * FROM projects ORDER BY created_at DESC')
    .all()
    .map(rowToProject)
}

// ───────────────────────────────────────────────────────────── issues

function rowToIssue(r: any): Issue {
  return {
    id: r.id,
    projectId: r.project_id,
    number: r.number,
    title: r.title,
    body: r.body,
    status: r.status,
    wave: r.wave,
    paths: JSON.parse(r.paths),
    dependencies: JSON.parse(r.dependencies),
    branch: r.branch,
    agentSlot: r.agent_slot,
    summary: r.summary,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export interface NewIssue {
  title: string
  body: string
  wave?: number
  paths?: string[]
  dependencies?: string[]
}

export function createIssue(projectId: string, issue: NewIssue): Issue {
  const next =
    (db.query('SELECT MAX(number) AS n FROM issues WHERE project_id = ?').get(projectId) as any)
      ?.n ?? 0
  const now = Date.now()
  const row: Issue = {
    id: id(),
    projectId,
    number: next + 1,
    title: issue.title,
    body: issue.body,
    status: 'todo',
    wave: issue.wave ?? 0,
    paths: issue.paths ?? [],
    dependencies: issue.dependencies ?? [],
    branch: null,
    agentSlot: null,
    summary: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
  db.query(
    `INSERT INTO issues (id, project_id, number, title, body, status, wave, paths, dependencies, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.projectId,
    row.number,
    row.title,
    row.body,
    row.status,
    row.wave,
    JSON.stringify(row.paths),
    JSON.stringify(row.dependencies),
    row.createdAt,
    row.updatedAt
  )
  return row
}

export function updateIssue(issueId: string, patch: Partial<Issue>): void {
  const columns: Record<string, string> = {
    status: 'status',
    branch: 'branch',
    agentSlot: 'agent_slot',
    summary: 'summary',
    error: 'error',
    wave: 'wave',
  }
  const sets: string[] = ['updated_at = ?']
  const values: (string | number | null)[] = [Date.now()]
  for (const [key, column] of Object.entries(columns)) {
    if (key in patch) {
      sets.push(`${column} = ?`)
      values.push((patch as any)[key])
    }
  }
  db.query(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`).run(...values, issueId)
}

export function getIssue(issueId: string): Issue | null {
  const row = db.query('SELECT * FROM issues WHERE id = ?').get(issueId)
  return row ? rowToIssue(row) : null
}

export function listIssues(projectId: string): Issue[] {
  return db
    .query('SELECT * FROM issues WHERE project_id = ? ORDER BY wave, number')
    .all(projectId)
    .map(rowToIssue)
}

// ───────────────────────────────────────────────────────────── events

export function recordEvent(
  projectId: string,
  issueId: string | null,
  type: string,
  payload: unknown
): RunEvent {
  const ts = Date.now()
  const res = db
    .query('INSERT INTO events (project_id, issue_id, ts, type, payload) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, issueId, ts, type, JSON.stringify(payload ?? null))
  return { id: Number(res.lastInsertRowid), projectId, issueId, ts, type, payload }
}

/** Recent events for a project, oldest first — used to hydrate a reconnecting client. */
export function listEvents(projectId: string, limit = 400): RunEvent[] {
  return db
    .query('SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT ?')
    .all(projectId, limit)
    .map((r: any) => ({
      id: r.id,
      projectId: r.project_id,
      issueId: r.issue_id,
      ts: r.ts,
      type: r.type,
      payload: JSON.parse(r.payload),
    }))
    .reverse()
}
