export type IssueStatus = 'todo' | 'running' | 'merging' | 'merged' | 'failed' | 'blocked'
export type ProjectStatus = 'planning' | 'provisioning' | 'building' | 'ready' | 'failed'

export interface Project {
  id: string
  name: string
  prompt: string
  status: ProjectStatus
  previewUrl: string | null
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
  branch: string | null
  agentSlot: number | null
  summary: string | null
  error: string | null
}

export interface BusEvent {
  id: number
  projectId: string
  issueId: string | null
  ts: number
  type: string
  payload: any
}

export interface ToolCall {
  name: string
  args?: unknown
  ok?: boolean
  phase: string
}

export interface AgentPanel {
  slot: number
  issueId: string | null
  issueTitle: string
  text: string
  tools: ToolCall[]
}
