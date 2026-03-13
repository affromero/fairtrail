import Anthropic from '@anthropic-ai/sdk';

export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExtractionResult {
  content: string;
  usage: ExtractionUsage;
}

interface ModelInfo {
  id: string;
  name: string;
  costPer1kInput: number;
  costPer1kOutput: number;
}

interface ProviderConfig {
  displayName: string;
  envKey: string;
  models: ModelInfo[];
  extract: (
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
  ) => Promise<ExtractionResult>;
}

export const EXTRACTION_PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    displayName: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        costPer1kInput: 0.001,
        costPer1kOutput: 0.005,
      },
      {
        id: 'claude-sonnet-4-6-20250514',
        name: 'Claude Sonnet 4.6',
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      },
    ],
    extract: async (apiKey, model, systemPrompt, userPrompt) => {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        content: text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  },
  openai: {
    displayName: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      {
        id: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        costPer1kInput: 0.0004,
        costPer1kOutput: 0.0016,
      },
    ],
    extract: async (apiKey, model, systemPrompt, userPrompt) => {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 8192,
      });

      return {
        content: response.choices[0]?.message.content ?? '',
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },
  },
  google: {
    displayName: 'Google',
    envKey: 'GOOGLE_AI_API_KEY',
    models: [
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0035,
      },
    ],
    extract: async (apiKey, model, systemPrompt, userPrompt) => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const genModel = genAI.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
      });

      const result = await genModel.generateContent(userPrompt);
      const response = result.response;

      return {
        content: response.text(),
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  },
  'claude-code': {
    displayName: 'Claude Code (Max)',
    envKey: 'CLAUDE_CODE_ENABLED',
    models: [
      { id: 'sonnet', name: 'Claude Sonnet (via CLI)', costPer1kInput: 0, costPer1kOutput: 0 },
      { id: 'opus', name: 'Claude Opus (via CLI)', costPer1kInput: 0, costPer1kOutput: 0 },
    ],
    extract: async (_apiKey, model, systemPrompt, userPrompt) => {
      const { spawn } = await import(/* webpackIgnore: true */ 'child_process');

      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      const result = await new Promise<string>((resolve, reject) => {
        const env = { ...process.env };
        delete env.ANTHROPIC_API_KEY;
        const proc = spawn('claude', ['--print', '--model', model], {
          timeout: 240_000,
          env,
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        proc.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        proc.on('close', (code) => {
          if (code !== 0) reject(new Error(`claude CLI exited ${code}: ${stderr}`));
          else resolve(stdout.trim());
        });
        proc.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') {
            reject(new Error('claude CLI not found. Restart the container to trigger install, or disable CLAUDE_CODE_ENABLED.'));
          } else {
            reject(err);
          }
        });
        proc.stdin.write(fullPrompt);
        proc.stdin.end();
      });

      return {
        content: result,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  },
  codex: {
    displayName: 'OpenAI Codex (CLI)',
    envKey: 'CODEX_ENABLED',
    models: [
      { id: 'codex', name: 'Codex CLI', costPer1kInput: 0, costPer1kOutput: 0 },
    ],
    extract: async (_apiKey, _model, systemPrompt, userPrompt) => {
      const { spawn } = await import(/* webpackIgnore: true */ 'child_process');

      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn('codex', ['--print'], {
          timeout: 240_000,
          env: { ...process.env },
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => {
          stdout += d.toString();
        });
        proc.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });
        proc.on('close', (code) => {
          if (code !== 0) reject(new Error(`codex CLI exited ${code}: ${stderr}`));
          else resolve(stdout.trim());
        });
        proc.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') {
            reject(new Error('codex CLI not found. Restart the container to trigger install, or disable CODEX_ENABLED.'));
          } else {
            reject(err);
          }
        });
        proc.stdin.write(fullPrompt);
        proc.stdin.end();
      });

      return {
        content: result,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  },
};

const CLI_PROVIDERS: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
};

export async function detectAvailableProviders(): Promise<string[]> {
  const available: string[] = [];

  for (const [key, config] of Object.entries(EXTRACTION_PROVIDERS)) {
    const cliBinary = CLI_PROVIDERS[key];
    if (cliBinary) {
      if (process.env[config.envKey] === 'true') {
        try {
          const { execSync } = await import('child_process');
          execSync(`which ${cliBinary}`, { stdio: 'ignore' });
          available.push(key);
        } catch {
          // CLI not found
        }
      }
      continue;
    }
    if (process.env[config.envKey]) {
      available.push(key);
    }
  }

  return available;
}

export function getModelCosts(
  provider: string,
  model: string
): { costPer1kInput: number; costPer1kOutput: number } {
  const p = EXTRACTION_PROVIDERS[provider];
  const m = p?.models.find((m) => m.id === model);
  return m ?? { costPer1kInput: 0, costPer1kOutput: 0 };
}
