# Mastra: tool results show as `[tool-result: <name>]` in MODEL_STEP span input

Minimal reproduction for a Mastra observability issue: in the input of a `model_step` span, a tool result is only shown
when the tool defines `toModelOutput`. Tools without it, including workflows exposed to an agent through `workflows`,
are shown as a `[tool-result: <toolName>]` placeholder, even though the result is available.

No API key is needed: the script uses a fake language model that calls one tool and then answers, and an in-memory
exporter that prints the spans.

## Run

```sh
npm install   # or pnpm install
npm start
```

Requires Node.js 22.13 or later. Tested with `@mastra/core` 1.82.0 and `@mastra/observability` 1.23.1.

## Output

```text
=== regular tool, no toModelOutput (getWeather)
tool_call span output:       {"city":"Paris","condition":"sunny","highC":24}
answer MODEL_STEP input tool message: "[tool-result: getWeather]"

=== regular tool, with toModelOutput (getWeatherMapped)
tool_call span output:       {"city":"Paris","condition":"sunny","highC":24}
answer MODEL_STEP input tool message: "{\"type\":\"json\",\"value\":{\"city\":\"Paris\",\"condition\":\"sunny\",\"highC\":24}}"

=== workflow tool (agent `workflows`) (workflow-weatherWorkflow)
tool_call span output:       {"result":{"city":"Paris","condition":"sunny","highC":24},"runId":"…"}
answer MODEL_STEP input tool message: "[tool-result: workflow-weatherWorkflow]"
```

## Expected

The tool message in the `model_step` input shows the tool result for all three tools, as it does for the tool with
`toModelOutput`.

## Where it happens

`summarizePart()` in `@mastra/observability` renders a `tool-result` part from `providerMetadata.mastra.modelOutput`,
which `@mastra/core` only sets when the tool defines `toModelOutput`. Otherwise it returns `[tool-result: <toolName>]`.
