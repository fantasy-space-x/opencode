import path from "path"
import { mkdir } from "fs/promises"
import type { ArgumentsCamelCase, Argv } from "yargs"
import { Effect } from "effect"
import { cmd, type WithDoubleDash } from "./cmd"
import { CliError } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions, type NetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"

const serveOptions = {
  "base-url": {
    type: "string" as const,
    describe: "base URL for the model API used by this server process",
  },
  "api-key": {
    type: "string" as const,
    describe: "API key for the selected model provider",
  },
  model: {
    type: "string" as const,
    describe: "model to use for new sessions, in provider/model format",
  },
  "history-dir": {
    type: "string" as const,
    describe: "directory for this server's opencode history database, or a .db file path",
  },
}

type ServeArgs = WithDoubleDash<
  NetworkOptions & {
    "base-url"?: string
    "api-key"?: string
    model?: string
    "history-dir"?: string
  }
>

export const ServeCommand = cmd<{}, ServeArgs>({
  command: "serve",
  builder: (yargs: Argv) => withNetworkOptions(yargs).options(serveOptions) as Argv<ServeArgs>,
  describe: "starts a headless opencode server",
  async handler(rawArgs) {
    const args = rawArgs as ArgumentsCamelCase<ServeArgs>
    await prepareServeOverrides(args)
    const { AppRuntime } = await import("@/effect/app-runtime")
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const { Server } = yield* Effect.promise(() => import("../../server/server"))
        if (!Flag.OPENCODE_SERVER_PASSWORD) {
          console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
        }
        const opts = yield* resolveNetworkOptions(args)
        const server = yield* Effect.promise(() => Server.listen(opts))
        if (args["base-url"]) console.log(`opencode server model base URL ${args["base-url"]}`)
        if (args.model) console.log(`opencode server model ${modelRef(args).full}`)
        if (args["history-dir"]) console.log(`opencode server history database ${historyDatabase(args["history-dir"])}`)
        console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

        yield* Effect.never
      }),
    )
  },
})

async function prepareServeOverrides(args: ServeArgs) {
  if (args["history-dir"]) {
    const db = historyDatabase(args["history-dir"])
    if (db !== ":memory:") await mkdir(path.dirname(db), { recursive: true })
    process.env.OPENCODE_DB = db
    Flag.OPENCODE_DB = db
  }

  if (!args.model && !args["base-url"] && !args["api-key"]) return
  if (!args.model) throw new CliError({ message: "--model is required when --base-url or --api-key is provided" })

  const model = modelRef(args)
  const nextConfig = mergeObject(readJsonObject(process.env.OPENCODE_CONFIG_CONTENT), {
    $schema: "https://opencode.ai/config.json",
    model: model.full,
    provider: {
      [model.providerID]: {
        npm: modelPackage(model.providerID),
        ...(args["base-url"] ? { api: args["base-url"] } : {}),
        options: {
          ...(args["base-url"] ? { baseURL: args["base-url"] } : {}),
          ...(args["api-key"] ? { apiKey: args["api-key"] } : {}),
        },
        models: {
          [model.modelID]: {
            id: model.apiID,
            name: model.modelID,
            provider: {
              npm: modelPackage(model.providerID),
              ...(args["base-url"] ? { api: args["base-url"] } : {}),
            },
            tool_call: true,
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    },
  })

  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(nextConfig)
  Flag.OPENCODE_CONFIG_CONTENT = process.env.OPENCODE_CONFIG_CONTENT
}

function modelRef(args: ServeArgs) {
  const providerID = providerIDFrom(args)
  const modelID = args.model?.includes("/") ? args.model.split("/").slice(1).join("/") : args.model
  const apiID = modelID ?? ""
  return {
    providerID,
    modelID: modelID ?? "",
    apiID,
    full: `${providerID}/${modelID ?? ""}`,
  }
}

function providerIDFrom(args: ServeArgs) {
  const explicit = args.model?.split("/")[0]
  if (explicit && args.model?.includes("/")) return explicit
  const base = args["base-url"]?.toLowerCase()
  if (base?.includes("deepseek")) return "deepseek"
  if (base?.includes("openrouter")) return "openrouter"
  if (base?.includes("anthropic")) return "anthropic"
  if (base?.includes("openai")) return "openai"
  return "openai-compatible"
}

function modelPackage(providerID: string) {
  if (providerID === "anthropic") return "@ai-sdk/anthropic"
  if (providerID === "openai") return "@ai-sdk/openai"
  return "@ai-sdk/openai-compatible"
}

function historyDatabase(input: string) {
  if (input === ":memory:") return input
  if (input.endsWith(".db")) return path.isAbsolute(input) ? input : path.resolve(input)
  if (path.isAbsolute(input)) return path.join(input, "opencode.db")
  return path.resolve(input, "opencode.db")
}

function readJsonObject(input: string | undefined) {
  try {
    const parsed = input ? JSON.parse(input) : {}
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {}
  return {}
}

function mergeObject(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set([...Object.keys(target), ...Object.keys(source)])].map((key) => {
      const targetValue = target[key]
      const sourceValue = source[key]
      if (isObject(targetValue) && isObject(sourceValue)) return [key, mergeObject(targetValue, sourceValue)]
      return [key, sourceValue ?? targetValue]
    }),
  )
}

function isObject(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input))
}
