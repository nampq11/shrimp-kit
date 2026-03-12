/**
 * Example: Basic chat with Azure OpenAI
 *
 * Run:
 *   cd packages/shrimp-agent
 *   tsx --env-file=../../.env examples/basic-chat.ts
 */

import { AzureOpenAIProvider, AgentLoop } from '../src/index.js';

const provider = new AzureOpenAIProvider({
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION,
});

const agent = new AgentLoop({
  provider,
  model: 'gpt-5-mini',
  systemPrompt: 'You are a helpful assistant. Keep answers concise.',
});

const result = await agent.run([
  { role: 'user', content: 'What is the capital of France? Answer in one sentence.' },
]);

console.log(result.text);
