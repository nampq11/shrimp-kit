/**
 * Example: Tool use with Azure OpenAI
 *
 * Demonstrates registering tools and letting the model call them.
 *
 * Run:
 *   cd packages/shrimp-agent
 *   tsx --env-file=../../.env examples/with-tools.ts
 */

import { AzureOpenAIProvider, AgentLoop, ToolRegistry } from '../src/index.js';

const provider = new AzureOpenAIProvider({
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
});

const registry = new ToolRegistry();

registry.register(
  {
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
      },
      required: ['city'],
    },
  },
  async (input) => {
    const city = input['city'] as string;
    // Simulate weather data
    return JSON.stringify({ city, temperature: '22°C', condition: 'Sunny' });
  },
);

registry.register(
  {
    name: 'get_time',
    description: 'Get the current local time.',
    input_schema: { type: 'object', properties: {} },
  },
  async () => {
    return new Date().toLocaleTimeString();
  },
);

const agent = new AgentLoop({
  provider,
  model: 'gpt-5-mini',
  systemPrompt: 'You are a helpful assistant with access to weather and time tools.',
  tools: registry.getDefinitions(),
  toolHandlers: registry.getHandlers(),
  onToolCall: (name, input) => {
    console.log(`[tool] ${name}(${JSON.stringify(input)})`);
  },
});

const result = await agent.run([
  { role: 'user', content: "What's the weather in Hanoi and what time is it?" },
]);

console.log(result.text);
