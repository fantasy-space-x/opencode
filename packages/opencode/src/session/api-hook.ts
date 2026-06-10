import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LLMError, LLMEvent, LLMRequest, LLMResponse } from "@opencode-ai/llm"
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "session.api_hook" })

type HookState = {
  events: LLMEvent[]
  text: Map<string, string>
  reasoning: Map<string, string>
  toolInput: Map<string, { name: string; text: string }>
  contentOrder: { type: "text" | "reasoning"; id: string }[]
}

const isType = <Type extends LLMEvent["type"]>(event: LLMEvent, type: Type): event is Extract<LLMEvent, { type: Type }> =>
  event.type === type

const stringify = (data: unknown) =>
  JSON.stringify(
    data,
    (_key, value) => {
      if (typeof value === "bigint") return String(value)
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        }
      }
      return value
    },
    0,
  )

const snapshot = <T>(value: T) => JSON.parse(stringify(value)) as T

const file = (directory: string, threadID: string) => path.join(directory, ".opencode", `${threadID}.jsonl`)

const append = Effect.fn("SessionApiHook.append")(function* (target: string, value: unknown) {
  yield* Effect.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.appendFile(target, stringify(value) + "\n")
    },
    catch: (error) => error,
  })
})

const summarize = (state: HookState) => {
  const response = new LLMResponse({ events: state.events, usage: LLMResponse.usage({ events: state.events }) })
  return {
    text: state.events.filter((event) => isType(event, "text-delta")).map((event) => event.text).join(""),
    reasoning: state.events.filter((event) => isType(event, "reasoning-delta")).map((event) => event.text).join(""),
    toolCalls: state.events.filter((event) => isType(event, "tool-call")),
    toolInputs: Array.from(state.toolInput.entries()).map(([id, value]) => ({ id, ...value })),
    content: state.contentOrder.flatMap((part) => {
      if (part.type === "text") {
        const value = state.text.get(part.id)
        return value === undefined ? [] : [{ type: "text", id: part.id, text: value }]
      }
      const value = state.reasoning.get(part.id)
      return value === undefined ? [] : [{ type: "reasoning", id: part.id, text: value }]
    }),
    usage: response.usage,
    providerErrors: state.events.filter((event) => isType(event, "provider-error")),
    finish: state.events.findLast((event) => isType(event, "finish")),
    stepFinish: state.events.findLast((event) => isType(event, "step-finish")),
    events: state.events,
  }
}

const collect = (state: HookState, event: LLMEvent) => {
  state.events.push(event)
  if (isType(event, "text-start")) {
    state.text.set(event.id, "")
    state.contentOrder.push({ type: "text", id: event.id })
    return
  }
  if (isType(event, "text-delta")) {
    state.text.set(event.id, (state.text.get(event.id) ?? "") + event.text)
    return
  }
  if (isType(event, "reasoning-start")) {
    state.reasoning.set(event.id, "")
    state.contentOrder.push({ type: "reasoning", id: event.id })
    return
  }
  if (isType(event, "reasoning-delta")) {
    state.reasoning.set(event.id, (state.reasoning.get(event.id) ?? "") + event.text)
    return
  }
  if (isType(event, "tool-input-start")) {
    state.toolInput.set(event.id, { name: event.name, text: "" })
    return
  }
  if (isType(event, "tool-input-delta")) {
    const current = state.toolInput.get(event.id)
    state.toolInput.set(event.id, { name: event.name, text: (current?.text ?? "") + event.text })
  }
}

export const createApiHook = Effect.fn("SessionApiHook.create")(function* (input: {
  sessionID: string
  agentID: string
  directory?: string
  workspaceID?: string
  kind?: string
  request: LLMRequest
}) {
  const directory = input.directory ?? process.cwd()
  const target = file(directory, input.sessionID)
  const startedAt = new Date().toISOString()
  const state: HookState = {
    events: [],
    text: new Map(),
    reasoning: new Map(),
    toolInput: new Map(),
    contentOrder: [],
  }
  return {
    event: (event: LLMEvent) =>
      Effect.sync(() => {
        collect(state, snapshot(event))
      }),
    eventSync: (event: LLMEvent) => {
      collect(state, snapshot(event))
    },
    finish: (result: { status: "success" | "provider-error" | "interrupted" | "failed"; error?: unknown }) =>
      append(target, {
        timestamp: new Date().toISOString(),
        startedAt,
        type: "llm.call",
        session_id: input.sessionID,
        thread_id: input.sessionID,
        agent: input.agentID,
        workspaceID: input.workspaceID,
        work_dir: directory,
        kind: input.kind,
        request: LLMRequest.input(input.request),
        response: {
          status: result.status,
          error:
            result.error instanceof LLMError
              ? {
                  module: result.error.module,
                  method: result.error.method,
                  reason: result.error.reason,
                }
              : result.error,
          ...summarize(state),
        },
      }).pipe(
        Effect.catch((error: unknown) =>
          Effect.sync(() =>
            log.warn("failed to write llm hook", {
              sessionID: input.sessionID,
              file: target,
              error,
            }),
          ),
        ),
      ),
  }
})

export * as SessionApiHook from "./api-hook"
