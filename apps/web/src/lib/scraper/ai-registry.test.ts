import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock child_process — vi.mock handles both static and dynamic imports
const mockSpawn = vi.fn();
const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// Must import after mocks
const { EXTRACTION_PROVIDERS, detectAvailableProviders } = await import(
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
    afterEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.CLAUDE_CODE_ENABLED;
      delete process.env.CODEX_ENABLED;
    });

    it('detects API-key providers when env vars are set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.OPENAI_API_KEY = 'sk-test';

      const providers = await detectAvailableProviders();

      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).not.toContain('google');
    });

    it('detects CLI providers when enabled and binary exists', async () => {
      process.env.CLAUDE_CODE_ENABLED = 'true';
      mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/claude'));

      const providers = await detectAvailableProviders();

      expect(providers).toContain('claude-code');
      expect(mockExecSync).toHaveBeenCalledWith('which claude', {
        stdio: 'ignore',
      });
    });

    it('skips CLI providers when binary is not found', async () => {
      process.env.CODEX_ENABLED = 'true';
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const providers = await detectAvailableProviders();

      expect(providers).not.toContain('codex');
    });

    it('skips CLI providers when not enabled even if binary exists', async () => {
      const providers = await detectAvailableProviders();

      expect(providers).not.toContain('codex');
      expect(providers).not.toContain('claude-code');
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

      // Verify spawn was called with env containing PATH
      expect(mockSpawn).toHaveBeenCalledWith(
        'codex',
        ['--print'],
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
