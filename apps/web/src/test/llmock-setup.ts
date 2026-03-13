/**
 * Global vitest setup — starts an LLMock server that catches any real SDK
 * calls that escape vi.mock(). This prevents 401 errors from leaked API
 * requests during tests.
 */
import { LLMock } from '@copilotkit/llmock';

const LLMOCK_PORT = 19876;

let mock: LLMock | null = null;

export async function setup() {
  mock = new LLMock({ port: LLMOCK_PORT });

  // Default fallback: return a valid but empty response for any unmatched request
  mock.onMessage(/./, {
    content: '[]',
  });

  await mock.start();
}

export async function teardown() {
  if (mock) {
    await mock.stop();
    mock = null;
  }
}
