/**
 * The preview sandbox: one long-lived VM per project that serves two purposes.
 *
 *  1. It runs the app, so there is a live URL showing what the agents have built.
 *  2. It is the integration environment — the merge queue verifies every merge
 *     here before accepting it.
 *
 * Those being the same machine is the point: a merge that passes verification
 * is, by construction, a preview that works.
 */
import { Sandbox } from 'e2b'
import { trackedFiles } from '../platform/git'

const WORKDIR = '/home/user/app'
const WEB_PORT = 5173

export interface PreviewHandle {
  sandboxId: string
  url: string
}

export class Preview {
  private constructor(
    readonly sbx: Sandbox,
    readonly url: string
  ) {}

  get sandboxId() {
    return this.sbx.sandboxId
  }

  /** Boot a preview: upload the repo, install once, start both dev servers. */
  static async start(repoPath: string, onLog: (line: string) => void): Promise<Preview> {
    const sbx = await Sandbox.create({ timeoutMs: 60 * 60_000 })
    onLog(`sandbox ${sbx.sandboxId} created`)

    const preview = new Preview(sbx, sbx.getHost(WEB_PORT))
    await preview.sync(repoPath)

    onLog('installing dependencies (this takes a minute)…')
    const api = await sbx.commands.run(`cd ${WORKDIR} && npm install --no-audit --no-fund`, {
      timeoutMs: 300_000,
    })
    if (api.exitCode !== 0) onLog(`api install failed: ${api.stderr.slice(-400)}`)

    const web = await sbx.commands.run(`cd ${WORKDIR}/web && npm install --no-audit --no-fund`, {
      timeoutMs: 300_000,
    })
    if (web.exitCode !== 0) onLog(`web install failed: ${web.stderr.slice(-400)}`)

    await preview.startServers(onLog)
    onLog(`preview live at https://${preview.url}`)
    return preview
  }

  /** Start (or restart) the API and the Vite dev server in the background. */
  async startServers(onLog: (line: string) => void): Promise<void> {
    await this.sbx.commands.run('pkill -f "node server" || true; pkill -f vite || true').catch(() => {})

    await this.sbx.commands.run(
      `cd ${WORKDIR} && nohup node server/index.js > /tmp/api.log 2>&1 &`,
      { background: true }
    )
    await this.sbx.commands.run(
      `cd ${WORKDIR}/web && nohup npx vite --host 0.0.0.0 --port ${WEB_PORT} > /tmp/web.log 2>&1 &`,
      { background: true }
    )

    // Give Vite a moment, then confirm it is actually serving.
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 2000))
      const check = await this.sbx.commands.run(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${WEB_PORT}/`
      )
      if (check.stdout.trim().startsWith('2')) return
    }
    const log = await this.sbx.commands.run('tail -20 /tmp/web.log').catch(() => null)
    onLog(`web server did not come up: ${log?.stdout ?? 'no log'}`)
  }

  /** Push the current repo state into the sandbox. */
  async sync(repoPath: string): Promise<void> {
    const files = await trackedFiles(repoPath)
    if (!files.length) return
    await this.sbx.files.write(
      files.map((f) => ({ path: `${WORKDIR}/${f.path}`, data: f.content }))
    )
  }

  /**
   * Verify the merged state. This is the gate the merge queue trusts — it runs
   * against the integrated repo, not against any single agent's branch.
   */
  async verify(repoPath: string): Promise<{ ok: boolean; output: string }> {
    await this.sync(repoPath)
    // Newly merged code may need packages the orchestrator added centrally.
    await this.sbx.commands
      .run(`cd ${WORKDIR} && npm install --no-audit --no-fund`, { timeoutMs: 240_000 })
      .catch(() => null)

    try {
      const res = await this.sbx.commands.run(`cd ${WORKDIR} && npm test`, { timeoutMs: 180_000 })
      return { ok: res.exitCode === 0, output: `${res.stdout}\n${res.stderr}`.slice(-4000) }
    } catch (err: any) {
      if (typeof err?.exitCode === 'number') {
        return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.slice(-4000) }
      }
      return { ok: false, output: String(err?.message ?? err) }
    }
  }

  async stop(): Promise<void> {
    await this.sbx.kill().catch(() => {})
  }
}
