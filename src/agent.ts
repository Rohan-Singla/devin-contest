/**
 * The agent loop: call model → execute tool calls → feed results back → repeat
 * until it submits, runs out of turns, or the operator interrupts.
 */
import type OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { complete, estimateTokens, MODELS, reasoningOf, type ModelName } from './llm'
import type { AgentSandbox } from './sandbox'
import { WORKDIR } from './sandbox'
import { runTool, type ToolContext } from './tools'
import { emit } from './trace'

const SYSTEM_PROMPT = `You are an autonomous software engineer working inside a disposable Linux sandbox.
The repository is at ${WORKDIR} and is your working directory for every command.

How to work:
1. ORIENT. List the file tree and read the files that matter before changing anything. Never guess at
   code you have not read.
2. REPRODUCE. Run the test suite first, so you know the failure before you attempt a fix. A task that
   mentions bugs almost always has tests that already expose them.
3. DIAGNOSE. For each failure, find the specific line responsible and explain the root cause to
   yourself. Fix causes, not symptoms — do not edit tests to make them pass, and do not special-case
   inputs to satisfy an assertion.
4. FIX. Make the smallest correct change. Prefer edit_file over rewriting whole files.
5. VERIFY. Re-run the tests after every change. If a fix does not work, read the new error and revise
   your diagnosis rather than trying variations at random.
6. SUBMIT. Only call submit once the full suite passes. Your summary must state each root cause and
   the evidence that it is fixed.

Rules:
- You are alone. There is nobody to ask, so make reasonable decisions and proceed.
- The sandbox is disposable — installing packages and running commands is safe and encouraged.
- If the task says there are N bugs, keep going until you have found all N. Do not stop at the first.
- Work in small steps and check your work as you go.`

export interface AgentOptions {
  task: string
  sandbox: AgentSandbox
  client: OpenAI
  model?: ModelName
  maxTurns?: number
  /** Compact history once the estimate crosses this many tokens. */
  compactAt?: number
}

export interface AgentResult {
  reason: 'submitted' | 'max_turns' | 'error'
  summary?: string
  turns: number
  usage: { input: number; output: number }
}

export async function runAgent({
  task,
  sandbox,
  client,
  model = MODELS.pro,
  maxTurns = 50,
  compactAt = 120_000,
}: AgentOptions): Promise<AgentResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: task },
  ]

  const ctx: ToolContext = { sandbox }
  const usage = { input: 0, output: 0 }

  for (let turn = 1; turn <= maxTurns; turn++) {
    if (estimateTokens(messages) > compactAt) {
      await compact(messages, client, model)
    }

    let response
    try {
      response = await complete(client, { model, messages })
    } catch (err: any) {
      emit({ type: 'error', message: err?.message ?? String(err) })
      return { reason: 'error', turns: turn, usage }
    }

    usage.input += response.usage?.prompt_tokens ?? 0
    usage.output += response.usage?.completion_tokens ?? 0
    emit({
      type: 'turn',
      n: turn,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    })

    const message = response.choices[0]!.message
    const reasoning = reasoningOf(message)
    if (reasoning) emit({ type: 'thinking', text: reasoning })
    if (typeof message.content === 'string' && message.content.trim()) {
      emit({ type: 'say', text: message.content })
    }

    // Strip reasoning before echoing back: it is not valid request-side content.
    messages.push({
      role: 'assistant',
      content: message.content ?? '',
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    })

    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length === 0) {
      // The model stopped without acting. Nudge it once rather than ending.
      messages.push({
        role: 'user',
        content:
          'Continue working on the task. Use your tools to make progress, or call submit if the ' +
          'work is genuinely complete and verified by a passing test run.',
      })
      continue
    }

    for (const call of toolCalls) {
      if (call.type !== 'function') continue
      const { name, arguments: rawArgs } = call.function
      let parsed: unknown = rawArgs
      try {
        parsed = JSON.parse(rawArgs)
      } catch {
        /* show the raw string in the trace */
      }
      emit({ type: 'tool_call', name, args: parsed, id: call.id })

      const started = Date.now()
      const { ok, output } = await runTool(name, rawArgs, ctx)
      emit({
        type: 'tool_result',
        id: call.id,
        ok,
        preview: output,
        ms: Date.now() - started,
      })

      messages.push({ role: 'tool', tool_call_id: call.id, content: output })
    }

    if (ctx.submission) {
      emit({ type: 'done', reason: 'submitted', summary: ctx.submission.summary, turns: turn })
      return { reason: 'submitted', summary: ctx.submission.summary, turns: turn, usage }
    }
  }

  emit({ type: 'done', reason: 'max_turns', turns: maxTurns })
  return { reason: 'max_turns', turns: maxTurns, usage }
}

/**
 * Summarize the earlier part of the conversation in place so long sessions stay
 * inside the context window. The cut point must not split an assistant message
 * from the tool results it is waiting on.
 */
async function compact(
  messages: ChatCompletionMessageParam[],
  client: OpenAI,
  model: ModelName
): Promise<void> {
  const KEEP_RECENT = 12
  let cut = messages.length - KEEP_RECENT
  // Walk forward to a boundary that is not a tool result orphaned from its call.
  while (cut < messages.length && messages[cut]!.role === 'tool') cut++
  if (cut <= 2) return

  const transcript = messages
    .slice(1, cut)
    .map((m) => `[${m.role}] ${JSON.stringify(m.content).slice(0, 1200)}`)
    .join('\n')

  const summaryResponse = await complete(client, {
    model,
    tools: false,
    reasoningEffort: 'low',
    maxTokens: 2000,
    messages: [
      {
        role: 'user',
        content:
          'Summarize this coding-agent transcript so work can continue without the full history. ' +
          'Preserve: the task, files inspected and what they contain, every root cause identified, ' +
          'every edit already applied, current test status, and what remains to be done.\n\n' +
          transcript,
      },
    ],
  })

  const summary = summaryResponse.choices[0]?.message.content ?? '(summary unavailable)'
  const dropped = cut - 1
  messages.splice(1, dropped, {
    role: 'user',
    content: `[Earlier work, condensed]\n${summary}`,
  })
  emit({ type: 'compact', droppedTurns: dropped, keptTokens: estimateTokens(messages) })
}
