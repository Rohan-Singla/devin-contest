/**
 * DeepSeek client. The API is OpenAI-compatible, so we drive it with the
 * official OpenAI SDK pointed at DeepSeek's base URL.
 */
import OpenAI from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { TOOL_SPECS } from './tools'

export const MODELS = {
  pro: 'deepseek-v4-pro',
  flash: 'deepseek-v4-flash',
} as const

export type ModelName = (typeof MODELS)[keyof typeof MODELS]

export function makeClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to .env or export it.')
  }
  return new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' })
}

/** Rough token estimate — good enough to decide when to compact. */
export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  return Math.ceil(JSON.stringify(messages).length / 3.6)
}

export interface CompleteOpts {
  model: ModelName
  messages: ChatCompletionMessageParam[]
  tools?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  /** Constrain the reply to a single JSON object. */
  json?: boolean
}

/** One model call, with bounded retries on transient failures. */
export async function complete(
  client: OpenAI,
  {
    model,
    messages,
    tools = true,
    reasoningEffort = 'medium',
    maxTokens = 8000,
    json = false,
  }: CompleteOpts
): Promise<ChatCompletion> {
  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    max_tokens: maxTokens,
    ...(tools ? { tools: TOOL_SPECS, tool_choice: 'auto' as const } : {}),
    ...(json ? { response_format: { type: 'json_object' as const } } : {}),
    // DeepSeek V4 supports tool use with thinking enabled.
    reasoning_effort: reasoningEffort,
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await client.chat.completions.create(params)
    } catch (err: any) {
      lastErr = err
      const status = err?.status
      // Client errors other than rate limiting won't fix themselves.
      if (status && status !== 429 && status < 500) throw err
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    }
  }
  throw lastErr
}

/** DeepSeek returns chain-of-thought on a non-standard field. */
export function reasoningOf(message: ChatCompletion.Choice['message']): string {
  return (message as { reasoning_content?: string }).reasoning_content ?? ''
}
