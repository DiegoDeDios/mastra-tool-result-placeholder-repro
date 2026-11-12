// Minimal reproduction: how tool results appear in the MODEL_STEP span input.
// A fake model (no API key needed) calls one tool, then answers. A capturing exporter prints
// the tool-result message from the input of the step that produces the answer.
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { Observability } from '@mastra/observability';
import { z } from 'zod';

const forecast = { city: 'Paris', condition: 'sunny', highC: 24 };

// 1. Regular tool without toModelOutput
const getWeather = createTool({
    id: 'getWeather',
    description: 'Get the weather for a city',
    inputSchema: z.object({ city: z.string() }),
    execute: async () => forecast,
});

// 2. Same tool with an identity toModelOutput
const getWeatherMapped = createTool({
    id: 'getWeatherMapped',
    description: 'Get the weather for a city',
    inputSchema: z.object({ city: z.string() }),
    execute: async () => forecast,
    toModelOutput: output => ({ type: 'json', value: output }),
});

// 3. Workflow exposed to the agent through `workflows`
const weatherWorkflow = createWorkflow({
    id: 'weather-workflow',
    description: 'Get the weather for a city',
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({ city: z.string(), condition: z.string(), highC: z.number() }),
})
    .then(
        createStep({
            id: 'fetch-forecast',
            inputSchema: z.object({ city: z.string() }),
            outputSchema: z.object({ city: z.string(), condition: z.string(), highC: z.number() }),
            execute: async () => forecast,
        })
    )
    .commit();

// Fake model: first call requests the tool given in `nextTool`, second call answers.
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
let nextTool;
let call = 0;
const stream = parts =>
    new ReadableStream({
        start(controller) {
            for (const part of [
                { type: 'stream-start', warnings: [] },
                { type: 'response-metadata', id: `response-${call}`, modelId: 'fake-model', timestamp: new Date() },
                ...parts,
            ])
                controller.enqueue(part);
            controller.close();
        },
    });
const model = {
    specificationVersion: 'v2',
    provider: 'fake',
    modelId: 'fake-model',
    supportedUrls: {},
    doGenerate: async () => {
        throw new Error('not used');
    },
    doStream: async () => {
        call += 1;
        if (call % 2 === 1) {
            return {
                stream: stream([
                    { type: 'tool-call', toolCallId: `call-${call}`, toolName: nextTool.name, input: JSON.stringify(nextTool.args) },
                    { type: 'finish', finishReason: 'tool-calls', usage },
                ]),
            };
        }
        return {
            stream: stream([
                { type: 'text-start', id: 'text' },
                { type: 'text-delta', id: 'text', delta: 'It is sunny in Paris, with a high of 24°C.' },
                { type: 'text-end', id: 'text' },
                { type: 'finish', finishReason: 'stop', usage },
            ]),
        };
    },
};

// Exporter that keeps every ended span in memory.
const spans = [];
const captureExporter = {
    name: 'capture',
    exportTracingEvent: async event => {
        if (event.type === 'span_ended') spans.push(event.exportedSpan);
    },
    flush: async () => {},
    shutdown: async () => {},
};

const agent = new Agent({
    id: 'weather-agent',
    name: 'Weather Agent',
    instructions: 'Answer weather questions using the tools.',
    model,
    tools: { getWeather, getWeatherMapped },
    workflows: { weatherWorkflow },
});

const mastra = new Mastra({
    agents: { agent },
    logger: false,
    observability: new Observability({ configs: { default: { serviceName: 'repro', exporters: [captureExporter] } } }),
});

const scenarios = [
    { label: 'regular tool, no toModelOutput', name: 'getWeather', args: { city: 'Paris' } },
    { label: 'regular tool, with toModelOutput', name: 'getWeatherMapped', args: { city: 'Paris' } },
    { label: 'workflow tool (agent `workflows`)', name: 'workflow-weatherWorkflow', args: { inputData: { city: 'Paris' } } },
];

for (const scenario of scenarios) {
    nextTool = scenario;
    spans.length = 0;
    const result = await mastra.getAgent('agent').stream('What is the weather in Paris?');
    for await (const _ of result.fullStream) {
        // drain the stream
    }
    await new Promise(resolve => setTimeout(resolve, 200));

    const toolSpan = spans.find(span => span.type === 'tool_call');
    const answerStep = spans.find(span => span.type === 'model_step' && span.output?.text);
    const toolMessage = answerStep?.input?.find?.(message => message.role === 'tool');

    console.log(`\n=== ${scenario.label} (${scenario.name})`);
    console.log('tool_call span output:      ', JSON.stringify(toolSpan?.output));
    console.log('answer MODEL_STEP input tool message:', JSON.stringify(toolMessage?.content));
}
process.exit(0);
