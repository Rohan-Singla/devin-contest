/**
 * Independent grading. The agent's own "I'm done" is a claim, not evidence —
 * this re-runs the suite in the sandbox and checks it didn't cheat.
 */
import type { AgentSandbox } from './sandbox'

export interface Verdict {
  testsPass: boolean
  touchedTests: string[]
  testOutput: string
  changedFiles: string[]
}

/** Paths that count as test files the agent must not modify. */
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\//i
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/i

export async function verify(sandbox: AgentSandbox, testCommand: string): Promise<Verdict> {
  const changed = await sandbox.exec(
    'git -c user.email=a@b -c user.name=agent add -A && git diff --cached --name-only'
  )
  const changedFiles = changed.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  const touchedTests = changedFiles.filter((f) => TEST_PATH.test(f) || TEST_FILE.test(f))

  const run = await sandbox.exec(testCommand, { timeoutMs: 180_000 })
  const testOutput = [run.stdout, run.stderr].filter((s) => s.trim()).join('\n')

  return {
    testsPass: run.exitCode === 0,
    touchedTests,
    testOutput,
    changedFiles,
  }
}

export function reportVerdict(v: Verdict): boolean {
  const green = '\x1b[32m'
  const red = '\x1b[31m'
  const yellow = '\x1b[33m'
  const gray = '\x1b[90m'
  const reset = '\x1b[0m'
  const bold = '\x1b[1m'

  console.log(`\n${bold}▌ VERIFICATION${reset} ${gray}(run by the harness, not the agent)${reset}`)
  console.log(
    `  tests: ${v.testsPass ? green + 'PASS' : red + 'FAIL'}${reset}` +
      `  ${gray}${v.changedFiles.length} file(s) changed${reset}`
  )

  if (v.touchedTests.length) {
    console.log(`  ${yellow}⚠ agent modified test files: ${v.touchedTests.join(', ')}${reset}`)
  }
  if (!v.testsPass) {
    const tail = v.testOutput.split('\n').slice(-25).join('\n')
    console.log(`${gray}${tail}${reset}`)
  }

  const passed = v.testsPass && v.touchedTests.length === 0
  console.log(
    `  ${bold}${passed ? green + 'TASK SOLVED' : red + 'TASK NOT SOLVED'}${reset}` +
      (v.testsPass && v.touchedTests.length ? ` ${gray}(tests pass, but they were edited)${reset}` : '')
  )
  return passed
}
