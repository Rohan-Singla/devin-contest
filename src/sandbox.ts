/**
 * E2B sandbox wrapper. The agent never touches the host filesystem — every
 * read, write and shell command below runs inside a disposable cloud VM.
 */
import { Sandbox } from 'e2b'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const WORKDIR = '/home/user/repo'

/** Directories we never upload — they're either huge or regenerable in-sandbox. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '__pycache__',
  '.venv',
])

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export class AgentSandbox {
  private constructor(readonly sbx: Sandbox) {}

  static async create(localRepo: string, timeoutMs = 15 * 60_000): Promise<AgentSandbox> {
    const sbx = await Sandbox.create({ timeoutMs })
    const wrapped = new AgentSandbox(sbx)
    await wrapped.upload(localRepo)
    return wrapped
  }

  get id() {
    return this.sbx.sandboxId
  }

  /** Recursively copy the local repo into the sandbox at WORKDIR. */
  private async upload(localRepo: string) {
    const files: { path: string; data: string }[] = []

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue
          walk(abs)
        } else if (entry.isFile()) {
          if (statSync(abs).size > MAX_UPLOAD_BYTES) continue
          const rel = relative(localRepo, abs).split(sep).join('/')
          files.push({ path: `${WORKDIR}/${rel}`, data: readFileSync(abs, 'utf8') })
        }
      }
    }

    walk(localRepo)
    if (files.length === 0) throw new Error(`No files found to upload in ${localRepo}`)
    await this.sbx.files.write(files)
  }

  /** Run a shell command inside the repo. Never throws on non-zero exit. */
  async exec(
    cmd: string,
    opts: { cwd?: string; timeoutMs?: number } = {}
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const res = await this.sbx.commands.run(cmd, {
        cwd: opts.cwd ?? WORKDIR,
        timeoutMs: opts.timeoutMs ?? 120_000,
      })
      return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr }
    } catch (err: any) {
      // CommandExitError carries the streams; a real failure (timeout) does not.
      if (typeof err?.exitCode === 'number') {
        return { exitCode: err.exitCode, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
      }
      return { exitCode: 1, stdout: '', stderr: String(err?.message ?? err) }
    }
  }

  async readFile(path: string): Promise<string> {
    return this.sbx.files.read(this.resolve(path))
  }

  async writeFile(path: string, data: string): Promise<void> {
    await this.sbx.files.write(this.resolve(path), data)
  }

  async exists(path: string): Promise<boolean> {
    return this.sbx.files.exists(this.resolve(path))
  }

  /** Turn an agent-supplied path (usually relative) into an absolute sandbox path. */
  resolve(path: string): string {
    return path.startsWith('/') ? path : `${WORKDIR}/${path.replace(/^\.\//, '')}`
  }

  /** Unified diff of everything the agent changed, for the final report. */
  async diff(): Promise<string> {
    const res = await this.exec(
      'git -c user.email=a@b -c user.name=agent add -A && git diff --cached'
    )
    return res.stdout.trim()
  }

  async kill() {
    await this.sbx.kill()
  }
}
