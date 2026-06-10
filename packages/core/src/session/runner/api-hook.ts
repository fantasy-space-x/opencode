import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { LLMError, LLMEvent, LLMRequest, LLMResponse } from "@opencode-ai/llm"
import * as Log from "../../util/log"
import * as SessionSchema from "../schema"
import { Location } from "../../location"

const log = Log.create({ service: "llm.api_hook" })

type HookState = {
  events: LLMEvent[]
  text: Map<string, string>
  reasoning: Map<string, string>
  toolInput: Map<string, { name: string; text: string }>
  contentOrder: { type: "text" | "reasoning"; id: string }[]
}

const text = (data: unknown) =>
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

const file = (directory: string, threadID: string) => path.join(directory, ".opencode", `${threadID}.jsonl`)

const append = Effect.fn("SessionRunnerApiHook.append")(function* (target: string, value: unknown) {
  yield* Effect.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.appendFile(target, text(value) + "\n")
    },
    catch: (error) => error,
  })
})

const summarize = (state: HookState) => {
  const response = new LLMResponse({ events: state.events, usage: LLMResponse.usage({ events: state.events }) })
  return {
    text: response.text,
    reasoning: response.reasoning,
    toolCalls: response.toolCalls,
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
    providerErrors: state.events.filter(LLMEvent.is.providerError),
    finish: state.events.findLast(LLMEvent.is.finish),
    stepFinish: state.events.findLast(LLMEvent.is.stepFinish),
    events: state.events,
  }
}

const collect = (state: HookState, event: LLMEvent) => {
  state.events.push(event)
  if (LLMEvent.is.textStart(event)) {
    state.text.set(event.id, "")
    state.contentOrder.push({ type: "text", id: event.id })
    return
  }
  if (LLMEvent.is.textDelta(event)) {
    state.text.set(event.id, (state.text.get(event.id) ?? "") + event.text)
    return
  }
  if (LLMEvent.is.reasoningStart(event)) {
    state.reasoning.set(event.id, "")
    state.contentOrder.push({ type: "reasoning", id: event.id })
    return
  }
  if (LLMEvent.is.reasoningDelta(event)) {
    state.reasoning.set(event.id, (state.reasoning.get(event.id) ?? "") + event.text)
    return
  }
  if (LLMEvent.is.toolInputStart(event)) {
    state.toolInput.set(event.id, { name: event.name, text: "" })
    return
  }
  if (LLMEvent.is.toolInputDelta(event)) {
    const current = state.toolInput.get(event.id)
    state.toolInput.set(event.id, { name: event.name, text: (current?.text ?? "") + event.text })
  }
}

export const createApiHook = Effect.fn("SessionRunnerApiHook.create")(function* (input: {
  sessionID: SessionSchema.ID
  location: Location.Ref
  request: LLMRequest
  agentID: string
}) {
  const target = file(input.location.directory, input.sessionID)
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
        collect(state, event)
      }),
    finish: (result: { status: "success" | "provider-error" | "interrupted" | "failed"; error?: unknown }) =>
      append(target, {
        timestamp: new Date().toISOString(),
        startedAt,
        type: "llm.call",
        session_id: input.sessionID,
        thread_id: input.sessionID,
        agent: input.agentID,
        workspaceID: input.location.workspaceID,
        work_dir: input.location.directory,
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
