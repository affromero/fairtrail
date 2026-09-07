import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { currentTravelExecution, TravelCleanupError, TravelExecution, travelDelay, withTravelExecution } from './execution';
import { travelNetworkResource } from './resources';

const execution = (jobId: string) => new TravelExecution({ jobId, generation: 1, resource: 'browser' });

describe('travel execution lifetime', () => {
  it('isolates concurrent jobs and leaves no scope after completion', async () => {
    const identities = await Promise.all(['first', 'second'].map(id => withTravelExecution(execution(id), async () => {
      await travelDelay(1);
      return currentTravelExecution()?.identity.jobId;
    })));
    expect(identities).toEqual(['first', 'second']);
    expect(currentTravelExecution()).toBeUndefined();
  });
  it('interrupts long waits when its job is cancelled', async () => {
    const scope = execution('cancelled');
    const waiting = withTravelExecution(scope, () => travelDelay(60_000));
    scope.abort(new Error('Job cancelled'));
    await expect(waiting).rejects.toThrow(/cancelled/);
  });
  it('rejects new work in a cancelled scope', async () => {
    const scope = execution('cancelled'); scope.abort(new Error('Lease lost'));
    await expect(withTravelExecution(scope, async () => 'unexpected')).rejects.toThrow(/Lease/);
  });
  it('preserves failures from the operation', async () => {
    await expect(withTravelExecution(execution('failed'), async () => { throw new Error('Provider unavailable'); })).rejects.toThrow(/Provider/);
  });
  it('does not report successful completion if provider code swallowed cancellation', async () => {
    const scope = execution('swallowed');
    await expect(withTravelExecution(scope, async () => {
      scope.abort(new Error('Worker replaced'));
      return 'late result';
    })).rejects.toThrow(/replaced/);
  });
  it('surfaces browser cleanup failure so the worker cannot safely release its resource', async () => {
    const scope = execution('cleanup-failure');
    const browser = {
      once: () => undefined,
      close: async () => { throw new Error('Browser transport unavailable'); },
    } as unknown as Browser;
    await expect(withTravelExecution(scope, async () => {
      await scope.launch(async () => browser);
      return 'result';
    })).rejects.toBeInstanceOf(TravelCleanupError);
  });
  it('retains both the provider failure and a subsequent unsafe cleanup failure', async () => {
    const scope = execution('two-failures');
    const browser = {
      once: () => undefined,
      close: async () => { throw new Error('Browser transport unavailable'); },
    } as unknown as Browser;
    const result = withTravelExecution(scope, async () => {
      await scope.launch(async () => browser);
      throw new Error('Provider unavailable');
    });
    await expect(result).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'Provider unavailable' }), expect.objectContaining({ message: expect.stringMatching(/cleanup failed/) })],
    });
  });
  it('keeps an aggregate cancellation reason distinct from a browser cleanup failure', async () => {
    const scope = execution('aggregate-cancellation');
    const reason = new AggregateError([new Error('Lease replaced')], 'Cancelled by coordinator');
    scope.abort(reason);
    await expect(withTravelExecution(scope, async () => 'unexpected')).rejects.toBe(reason);
  });
});

describe('travel network topology', () => {
  it('places every search on one resource when VPN changes all host traffic', () => {
    const topology = { vpnEnabled: true, systemWide: true };
    expect(travelNetworkResource(topology, true)).toBe('network');
    expect(travelNetworkResource(topology, false)).toBe('network');
  });
  it('separates direct browsing from a SOCKS tunnel while serializing tunnel clients', () => {
    const topology = { vpnEnabled: true, systemWide: false };
    expect(travelNetworkResource(topology, true)).toBe('vpn');
    expect(travelNetworkResource(topology, false)).toBe('browser');
  });
  it('does not impose a host-wide lock when VPN is disabled', () => {
    expect(travelNetworkResource({ vpnEnabled: false, systemWide: true }, false)).toBe('browser');
  });
});
