/**
 * Backs Pi's built-in tools with an E2B sandbox.
 *
 * Pi exposes a pluggable `operations` seam on every file/shell tool, documented
 * for delegating to remote systems. That is exactly our case: the agent runs on
 * this host, but every read, write and command must land inside a disposable
 * cloud VM. So we keep Pi's real tools — with its truncation, diffing and
 * rendering — and swap only the I/O layer underneath them.
 */
import type { BashOperations } from '@earendil-works/pi-coding-agent'
import type { AgentSandbox } from '../sandbox'

/** Shell execution, streamed back to Pi chunk by chunk. */
export function bashOps(sandbox: AgentSandbox): BashOperations {
  return {
    async exec(command, cwd, options) {
      try {
        const result = await sandbox.sbx.commands.run(command, {
          cwd,
          timeoutMs: options.timeout ?? 120_000,
          onStdout: (data) => options.onData(Buffer.from(data)),
          onStderr: (data) => options.onData(Buffer.from(data)),
        })
        return { exitCode: result.exitCode }
      } catch (err: any) {
        // A non-zero exit arrives as CommandExitError and carries the streams.
        if (typeof err?.exitCode === 'number') {
          if (err.stdout) options.onData(Buffer.from(err.stdout))
          if (err.stderr) options.onData(Buffer.from(err.stderr))
          return { exitCode: err.exitCode }
        }
        options.onData(Buffer.from(String(err?.message ?? err)))
        return { exitCode: 1 }
      }
    },
  }
}

export function readOps(sandbox: AgentSandbox) {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      return Buffer.from(await sandbox.sbx.files.read(absolutePath))
    },
    async access(absolutePath: string): Promise<void> {
      if (!(await sandbox.sbx.files.exists(absolutePath))) {
        throw Object.assign(new Error(`ENOENT: no such file, ${absolutePath}`), { code: 'ENOENT' })
      }
    },
    // Images inside the sandbox are out of scope; tell Pi everything is text.
    async detectImageMimeType(): Promise<null> {
      return null
    },
  }
}

export function writeOps(sandbox: AgentSandbox) {
  return {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await sandbox.sbx.files.write(absolutePath, content)
    },
    async mkdir(dir: string): Promise<void> {
      await sandbox.sbx.files.makeDir(dir)
    },
  }
}

export function editOps(sandbox: AgentSandbox) {
  return {
    ...readOps(sandbox),
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await sandbox.sbx.files.write(absolutePath, content)
    },
  }
}

export function lsOps(sandbox: AgentSandbox) {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      return sandbox.sbx.files.exists(absolutePath)
    },
    async stat(absolutePath: string) {
      const entries = await sandbox.sbx.files.list(absolutePath).catch(() => null)
      // `list` only succeeds on directories, which is the distinction Pi needs.
      return { isDirectory: () => entries !== null }
    },
    async readdir(absolutePath: string): Promise<string[]> {
      const entries = await sandbox.sbx.files.list(absolutePath)
      return entries.map((e) => e.name)
    },
  }
}

export function grepOps(sandbox: AgentSandbox) {
  return {
    async isDirectory(absolutePath: string): Promise<boolean> {
      const entries = await sandbox.sbx.files.list(absolutePath).catch(() => null)
      return entries !== null
    },
    async readFile(absolutePath: string): Promise<string> {
      return sandbox.sbx.files.read(absolutePath)
    },
  }
}
