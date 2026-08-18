/**
 * DeepSeek client, used by the planner.
 *
 * Agents do not go through here — they run on Pi, which has its own provider
 * layer. This is only for the one-shot structured calls the orchestrator makes.
 * The API is OpenAI-compatible, so the official OpenAI SDK drives it.
 */
import OpenAI from 'openai'
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

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

export interface CompleteOpts {
  model: ModelName
  messages: ChatCompletionMessageParam[]
  reasoningEffort?: 'low' | 'medium' | 'high'
  maxTokens?: number
  /** Constrain the reply to a single JSON object. */
  json?: boolean
}

/** One model call, with bounded retries on transient failures. */
export async function complete(
  client: OpenAI,
  { model, messages, reasoningEffort = 'medium', maxTokens = 8000, json = false }: CompleteOpts
): Promise<ChatCompletion> {
  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' as const } } : {}),
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
