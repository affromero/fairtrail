import { describe, expect, it } from 'vitest';
import { validateCarProtectionChoice } from './protection-choice';

const now = new Date('2026-09-07T12:00:00Z');
const fixture = () => ({ source: 'discovercars', productId: '35', name: 'Full Coverage', termsSummary: 'Covered damage and exclusions; reimbursement terms apply.',
  policyLinks: ['https://www.sincerainsurance.com/en/legal/terms-and-conditions/full-coverage/example'],
  observedExtraPrice: { currency: 'USD', minor: 5533 }, sourceUrl: 'https://www.discovercars.com/offer/coverage/example', observedAt: now.toISOString() });

describe('stored unselected protection evidence', () => {
  it('retains terms and extra price without claiming a selected or all-in quote', () => {
    const choice = validateCarProtectionChoice({ ...fixture(), selected: true, eligible: true, total: 1 }, now);
    expect(choice).toEqual(fixture());
    expect(choice).not.toHaveProperty('selected');
    expect(choice).not.toHaveProperty('eligible');
    expect(choice).not.toHaveProperty('total');
  });
  it.each(['javascript:alert(1)', 'http://www.sincerainsurance.com/policy', 'https://www.sincerainsurance.com.evil.example/policy',
    'https://user:password@www.sincerainsurance.com/policy', 'https://www.sincerainsurance.com:444/policy'])('rejects unsafe policy URL %s', url => {
    expect(() => validateCarProtectionChoice({ ...fixture(), policyLinks: [url] }, now)).toThrow();
  });
  it('rejects policy links and quote evidence belonging to the other provider', () => {
    expect(() => validateCarProtectionChoice({ ...fixture(), policyLinks: ['https://www.globalmediaserver.com/policy.pdf'] }, now)).toThrow(/policy link/);
    expect(() => validateCarProtectionChoice({ ...fixture(), sourceUrl: 'https://book.autoeurope.com/en-us/options' }, now)).toThrow(/selected provider/);
  });
  it('rejects missing, duplicate and excessive policy link collections', () => {
    expect(() => validateCarProtectionChoice({ ...fixture(), policyLinks: undefined }, now)).toThrow(/policy links/);
    expect(() => validateCarProtectionChoice({ ...fixture(), policyLinks: Array(2).fill(fixture().policyLinks[0]) }, now)).toThrow(/Duplicate/);
    expect(() => validateCarProtectionChoice({ ...fixture(), policyLinks: Array(9).fill(fixture().policyLinks[0]) }, now)).toThrow(/policy links/);
  });
  it.each(['basic', '35]button', '35\n', ''])('rejects invalid product identity %j', productId => {
    expect(() => validateCarProtectionChoice({ ...fixture(), productId }, now)).toThrow();
  });
  it('rejects future observations and fractional minor-unit prices', () => {
    expect(() => validateCarProtectionChoice({ ...fixture(), observedAt: '2026-09-08T12:00:00Z' }, now)).toThrow(/future/);
    expect(() => validateCarProtectionChoice({ ...fixture(), observedExtraPrice: { currency: 'USD', minor: 55.33 } }, now)).toThrow(/minor/);
  });
});
