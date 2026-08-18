/**
 * Host-side git. Each project is a real repository on disk; agents work in
 * sandboxes and hand back patches, which land here on their own branch and are
 * merged one at a time by the merge queue.
 */
import { simpleGit, type SimpleGit } from 'simple-git'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const AUTHOR = ['-c', 'user.email=agent@mini-devin.local', '-c', 'user.name=mini-devin']

export function repo(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
}

/** Create a project repository seeded from the template, with one baseline commit. */
export async function initRepo(repoPath: string, templatePath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  cpSync(templatePath, repoPath, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.includes('/.git/'),
  })

  const git = repo(repoPath)
  await git.init()
  await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git.add('.')
  await git.raw([...AUTHOR, 'commit', '-m', 'scaffold: project template'])
}

/**
 * Apply an agent's patch on a fresh branch cut from main.
 * Returns false when the patch does not apply (main moved underneath it).
 */
export async function applyPatchToBranch(
  repoPath: string,
  branch: string,
  patch: string,
  message: string
): Promise<{ applied: boolean; reason?: string }> {
  const git = repo(repoPath)
  await git.checkout('main')

  const branches = await git.branchLocal()
  if (branches.all.includes(branch)) await git.deleteLocalBranch(branch, true)
  await git.checkoutLocalBranch(branch)

  if (!patch.trim()) return { applied: false, reason: 'agent produced an empty patch' }

  const patchFile = join(repoPath, '.agent.patch')
  writeFileSync(patchFile, patch.endsWith('\n') ? patch : patch + '\n')
  try {
    await git.raw(['apply', '--whitespace=nowarn', '.agent.patch'])
  } catch (err: any) {
    await git.checkout('main')
    return { applied: false, reason: `patch did not apply: ${err?.message ?? err}` }
  } finally {
    try {
      Bun.spawnSync(['rm', '-f', patchFile])
    } catch {
      /* best effort */
    }
  }

  await git.add('.')
  await git.raw([...AUTHOR, 'commit', '-m', message])
  await git.checkout('main')
  return { applied: true }
}

/** Merge a branch into main. Never leaves the repo in a conflicted state. */
export async function mergeBranch(
  repoPath: string,
  branch: string
): Promise<{ merged: boolean; conflicts?: string[]; reason?: string }> {
  const git = repo(repoPath)
  await git.checkout('main')
  try {
    await git.raw([...AUTHOR, 'merge', '--no-ff', '-m', `merge ${branch}`, branch])
    return { merged: true }
  } catch (err: any) {
    const status = await git.status()
    const conflicts = status.conflicted
    await git.raw(['merge', '--abort']).catch(() => {})
    return { merged: false, conflicts, reason: err?.message ?? String(err) }
  }
}

/** Undo the most recent commit on main — used when a merge fails verification. */
export async function revertLastMerge(repoPath: string): Promise<void> {
  const git = repo(repoPath)
  await git.checkout('main')
  await git.reset(['--hard', 'HEAD~1'])
}

export async function currentHead(repoPath: string): Promise<string> {
  return (await repo(repoPath).revparse(['--short', 'HEAD'])).trim()
}

/**
 * Dependencies are applied centrally, never by agents — package.json is the
 * single most contended file in a parallel build.
 */
export async function addDependencies(
  repoPath: string,
  deps: string[],
  scope: 'server' | 'web' = 'server'
): Promise<string[]> {
  if (!deps.length) return []
  const pkgPath = scope === 'web' ? join(repoPath, 'web', 'package.json') : join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return []

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dependencies ??= {}
  const added: string[] = []
  for (const dep of deps) {
    const [name, version] = dep.startsWith('@')
      ? [dep, 'latest']
      : [dep.split('@')[0]!, dep.split('@')[1] ?? 'latest']
    if (!pkg.dependencies[name]) {
      pkg.dependencies[name] = version === 'latest' ? '*' : version
      added.push(name)
    }
  }
  if (!added.length) return []

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  const git = repo(repoPath)
  await git.add('.')
  await git.raw([...AUTHOR, 'commit', '-m', `deps: add ${added.join(', ')}`])
  return added
}

/** Every tracked file, for uploading the current state into a sandbox. */
export async function trackedFiles(repoPath: string): Promise<{ path: string; content: string }[]> {
  const git = repo(repoPath)
  const list = (await git.raw(['ls-files'])).split('\n').map((s) => s.trim()).filter(Boolean)
  return list.map((rel) => ({
    path: rel,
    content: readFileSync(join(repoPath, rel), 'utf8'),
  }))
}

export async function log(repoPath: string, limit = 20) {
  const git = repo(repoPath)
  const entries = await git.log({ maxCount: limit })
  return entries.all.map((c) => ({ hash: c.hash.slice(0, 7), message: c.message, date: c.date }))
}
