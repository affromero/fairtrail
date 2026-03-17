import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock child_process — vi.mock handles both static and dynamic imports
const mockSpawn = vi.fn();
const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: (...args: unknown[]) => mockExistsSync(...args) };
});

// Must import after mocks
const { EXTRACTION_PROVIDERS, LOCAL_PROVIDERS, detectAvailableProviders, filterCliStderr } = await import(
  './ai-registry'
);

/** Create a fake ChildProcess-like EventEmitter with stdin/stdout/stderr */
function createFakeProc() {
  const proc = new EventEmitter() as EventEmitter & Pick<ChildProcess, 'stdin' | 'stdout' | 'stderr'>;
  proc.stdout = new EventEmitter() as ChildProcess['stdout'];
  proc.stderr = new EventEmitter() as ChildProcess['stderr'];
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as ChildProcess['stdin'];
  return proc;
}

describe('ai-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectAvailableProviders', () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      // Save and clear LLM env vars (setup.ts sets dummy keys globally)
      for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_AI_API_KEY', 'SELF_HOSTED']) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    });

    afterEach(() => {
      // Restore original env
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    });

    it('detects API-key providers when env vars are set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OPENAI_API_KEY = 'sk-test';

      const providers = await detectAvailableProviders();

      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).not.toContain('google');
    });

    it('auto-detects CLI providers when binary and auth exist', async () => {
      mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/claude'));
      mockExistsSync.mockReturnValue(true);

      const providers = await detectAvailableProviders();

      expect(providers).toContain('claude-code');
      expect(mockExecSync).toHaveBeenCalledWith('which claude', {
        stdio: 'ignore',
      });
    });

    it('skips CLI providers when binary exists but no auth', async () => {
      mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/codex'));
      mockExistsSync.mockReturnValue(false);

      const providers = await detectAvailableProviders();

      expect(providers).not.toContain('codex');
      expect(providers).not.toContain('claude-code');
    });

    it('skips CLI providers when binary is not found', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const providers = await detectAvailableProviders();

      expect(providers).not.toContain('codex');
      expect(providers).not.toContain('claude-code');
    });

    it('includes local providers when SELF_HOSTED=true', async () => {
      process.env.SELF_HOSTED = 'true';

      const providers = await detectAvailableProviders();

      expect(providers).toContain('ollama');
      expect(providers).toContain('llamacpp');
    });

    it('excludes local providers when SELF_HOSTED is not set', async () => {
      const providers = await detectAvailableProviders();

      expect(providers).not.toContain('ollama');
      expect(providers).not.toContain('llamacpp');
    });
  });

  describe('allowCustomModel', () => {
    it('is enabled for openai, ollama, and llamacpp providers', () => {
      expect(EXTRACTION_PROVIDERS.openai!.allowCustomModel).toBe(true);
      expect(EXTRACTION_PROVIDERS.ollama!.allowCustomModel).toBe(true);
      expect(EXTRACTION_PROVIDERS.llamacpp!.allowCustomModel).toBe(true);
    });

    it('is not enabled for other providers', () => {
      expect(EXTRACTION_PROVIDERS.anthropic!.allowCustomModel).toBeUndefined();
      expect(EXTRACTION_PROVIDERS.google!.allowCustomModel).toBeUndefined();
    });
  });

  describe('local providers', () => {
    it('ollama provider exists with correct config', () => {
      const ollama = EXTRACTION_PROVIDERS.ollama!;
      expect(ollama.displayName).toBe('Ollama');
      expect(ollama.allowCustomBaseUrl).toBe(true);
      expect(ollama.defaultBaseUrl).toBe('http://localhost:11434/v1');
      expect(ollama.models).toHaveLength(0);
      expect(ollama.envKey).toBeUndefined();
    });

    it('llamacpp provider exists with correct config', () => {
      const llamacpp = EXTRACTION_PROVIDERS.llamacpp!;
      expect(llamacpp.displayName).toBe('llama.cpp');
      expect(llamacpp.allowCustomBaseUrl).toBe(true);
      expect(llamacpp.defaultBaseUrl).toBe('http://localhost:8080/v1');
      expect(llamacpp.models).toHaveLength(0);
      expect(llamacpp.envKey).toBeUndefined();
    });

    it('openai provider has allowCustomBaseUrl', () => {
      expect(EXTRACTION_PROVIDERS.openai!.allowCustomBaseUrl).toBe(true);
    });

    it('LOCAL_PROVIDERS includes ollama and llamacpp', () => {
      expect(LOCAL_PROVIDERS.has('ollama')).toBe(true);
      expect(LOCAL_PROVIDERS.has('llamacpp')).toBe(true);
      expect(LOCAL_PROVIDERS.has('openai')).toBe(false);
    });
  });

  describe('codex extract — ENOENT handling', () => {
    it('rejects with actionable message when codex binary is missing', async () => {
      const fakeProc = createFakeProc();
      mockSpawn.mockReturnValue(fakeProc);

      const extractPromise = EXTRACTION_PROVIDERS.codex!.extract(
        '',
        'codex',
        'system',
        'user'
      );

      // Give the dynamic import a tick to resolve
      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      // Simulate ENOENT error
      const err = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      fakeProc.emit('error', err);

      await expect(extractPromise).rejects.toThrow(
        /codex CLI not found.*Restart the container/
      );
    });
  });

  describe('claude-code extract — ENOENT handling', () => {
    it('rejects with actionable message when claude binary is missing', async () => {
      const fakeProc = createFakeProc();
      mockSpawn.mockReturnValue(fakeProc);

      const extractPromise = EXTRACTION_PROVIDERS['claude-code']!.extract(
        '',
        'sonnet',
        'system',
        'user'
      );

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      fakeProc.emit('error', err);

      await expect(extractPromise).rejects.toThrow(
        /claude CLI not found.*Restart the container/
      );
    });
  });

  describe('filterCliStderr', () => {
    it('strips PATH warning lines from stderr', () => {
      const stderr = 'could not update PATH\nError: something went wrong\ncould not update PATH to include /usr/bin';
      expect(filterCliStderr(stderr)).toBe('Error: something went wrong');
    });

    it('returns empty string when all lines are PATH warnings', () => {
      expect(filterCliStderr('could not update PATH')).toBe('');
    });

    it('preserves non-warning lines unchanged', () => {
      expect(filterCliStderr('real error message')).toBe('real error message');
    });
  });

  describe('codex extract — 401 auth hint', () => {
    it('includes auth hint when stderr contains 401', async () => {
      const fakeProc = createFakeProc();
      mockSpawn.mockReturnValue(fakeProc);

      const extractPromise = EXTRACTION_PROVIDERS.codex!.extract(
        '',
        'codex',
        'system',
        'user'
      );

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      // Emit 401 on stderr, then close with error
      fakeProc.stderr!.emit('data', Buffer.from('401 Unauthorized'));
      fakeProc.emit('close', 1);

      await expect(extractPromise).rejects.toThrow(
        /ensure codex is authenticated on the host via `codex auth`/
      );
    });

    it('does not include auth hint for non-401 errors', async () => {
      const fakeProc = createFakeProc();
      mockSpawn.mockReturnValue(fakeProc);

      const extractPromise = EXTRACTION_PROVIDERS.codex!.extract(
        '',
        'codex',
        'system',
        'user'
      );

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      fakeProc.stderr!.emit('data', Buffer.from('some other error'));
      fakeProc.emit('close', 1);

      await expect(extractPromise).rejects.toThrow('codex CLI exited 1: some other error');
      await expect(extractPromise).rejects.not.toThrow(/codex auth/);
    });
  });

  describe('codex extract passes env to spawn', () => {
    it('includes process.env in spawn options', async () => {
      const fakeProc = createFakeProc();
      mockSpawn.mockReturnValue(fakeProc);

      const extractPromise = EXTRACTION_PROVIDERS.codex!.extract(
        '',
        'codex',
        'system',
        'user'
      );

      await vi.waitFor(() => {
        expect(mockSpawn).toHaveBeenCalled();
      });

      // Verify spawn was called with exec subcommand and env
      expect(mockSpawn).toHaveBeenCalledWith(
        'codex',
        expect.arrayContaining(['exec', '-', '--skip-git-repo-check', '--ephemeral']),
        expect.objectContaining({
          env: expect.objectContaining({ PATH: expect.any(String) }),
        })
      );

      // Clean up: resolve the promise
      fakeProc.emit('close', 0);
      await extractPromise.catch(() => {});
    });
  });
});
