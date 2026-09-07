import { describe, expect, it } from 'vitest';
import { carOfferFixture, carReportFixture, carSearchFixture } from '@/test/car-fixtures';
import { carProtectionQuoteIdentity, validateCarProtectionDiscovery, type CarProtectionDiscovery } from './protection-discovery';
import { validateCarReport } from './report';

const now = new Date();
function fixture(): CarProtectionDiscovery {
  return { offerId: 'verified-quote', status: 'complete', error: null, choices: [{
    id: 'c51f31ce-1f53-486b-b84c-2817429f3a73', source: 'discovercars', productId: '35', name: 'Full Coverage',
    termsSummary: 'Reimbursement subject to exclusions.', policyLinks: [], observedExtraPrice: { currency: 'GBP', minor: 1800 },
    sourceUrl: 'https://www.discovercars.com/offer/coverage/example', observedAt: now.toISOString(),
  }] };
}
const offers = () => [carOfferFixture(now.toISOString())];

describe('protection discovery bound to returned rental observations', () => {
  it('preserves stable choice IDs through repeated report serialization without changing base quotes', () => {
    const report = { ...carReportFixture(offers()), protection: [fixture()] };
    const validated = validateCarReport(report, carSearchFixture().sources, now);
    expect(validated).toEqual(report);
    expect(validateCarReport(JSON.parse(JSON.stringify(validated)), carSearchFixture().sources, now)).toEqual(report);
    expect(validated.offers[0]?.total).toEqual(report.offers[0]?.total);
  });
  it('distinguishes unrequested discovery, an unchecked offer, and a completed search with no products', () => {
    const report = carReportFixture(offers());
    expect(validateCarReport(report, carSearchFixture().sources, now)).not.toHaveProperty('protection');
    expect(validateCarReport({ ...report, protection: [] }, carSearchFixture().sources, now).protection).toEqual([]);
    expect(validateCarProtectionDiscovery([{ ...fixture(), choices: [] }], offers(), now)).toEqual([{ offerId: 'verified-quote', status: 'complete', choices: [], error: null }]);
  });
  it('retains explicit failed discovery only when provider progress also exposes its failure', () => {
    const error = 'Protection options could not be verified';
    const report = { ...carReportFixture(offers()), protection: [{ offerId: 'verified-quote', status: 'failed', choices: [], error }] };
    expect(() => validateCarReport(report, carSearchFixture().sources, now)).toThrow(/progress/);
    report.providers[0]!.status = 'partial'; report.errors.push({ source: 'discovercars', message: error });
    expect(validateCarReport(report, carSearchFixture().sources, now)).toMatchObject({ offers: report.offers, protection: report.protection });
  });
  it('rejects choices attached to absent or duplicate offers', () => {
    expect(() => validateCarProtectionDiscovery([fixture()], [], now)).toThrow();
    expect(() => validateCarProtectionDiscovery([fixture()], [...offers(), ...offers()], now)).toThrow(/unique/);
    expect(() => validateCarProtectionDiscovery([fixture(), fixture()], [...offers(), { ...offers()[0]!, id: 'second' }], now)).toThrow(/unique/);
  });
  it('rejects changed providers or quote identities even when the search context could match', () => {
    const entry = fixture(); entry.choices[0]!.sourceUrl = 'https://www.discovercars.com/offer/coverage/another';
    expect(() => validateCarProtectionDiscovery([entry], offers(), now)).toThrow(/another rental/);
    Object.assign(entry.choices[0]!, { source: 'autoeurope', productId: 'ZC.GBP', sourceUrl: 'https://book.autoeurope.com/en-us/options?rate_reference=example' });
    expect(() => validateCarProtectionDiscovery([entry], offers(), now)).toThrow(/another rental/);
  });
  it('rejects repeated product identities within an offer and repeated opaque IDs across offers', () => {
    const entry = fixture(); entry.choices.push({ ...entry.choices[0]!, id: 'c51f31ce-1f53-486b-b84c-2817429f3a74' });
    expect(() => validateCarProtectionDiscovery([entry], offers(), now)).toThrow(/identity/);
    const second = { ...fixture(), offerId: 'second' };
    second.choices[0]!.sourceUrl = 'https://www.discovercars.com/offer/coverage/second';
    expect(() => validateCarProtectionDiscovery([fixture(), second], [...offers(), { ...offers()[0]!, id: 'second', bookingUrl: 'https://www.discovercars.com/offer/second' }], now)).toThrow(/identity/);
  });
  it.each([-1, 300_001])('rejects protection captured %sms relative to its base offer', delta => {
    const entry = fixture(); entry.choices[0]!.observedAt = new Date(now.getTime() + delta).toISOString();
    expect(() => validateCarProtectionDiscovery([entry], offers(), new Date(now.getTime() + 400_000))).toThrow(/another rental/);
  });
  it('rejects failed discovery with products, completed discovery with errors, and excessive choices', () => {
    expect(() => validateCarProtectionDiscovery([{ ...fixture(), status: 'failed', error: 'Failed' }], offers(), now)).toThrow(/cannot offer/);
    expect(() => validateCarProtectionDiscovery([{ ...fixture(), error: 'Failed' }], offers(), now)).toThrow(/cannot contain/);
    expect(() => validateCarProtectionDiscovery([{ ...fixture(), choices: Array(9).fill(fixture().choices[0]) }], offers(), now)).toThrow(/choices/);
  });
  it('compares canonical quote identities across options and checkout without confusing supplier substitutions', () => {
    expect(carProtectionQuoteIdentity('https://www.discovercars.com/offer/example?sq=criteria', 'discovercars'))
      .toBe(carProtectionQuoteIdentity('https://www.discovercars.com/offer/coverage/example', 'discovercars'));
    const original = 'https://book.autoeurope.com/en-us/options?rate_reference=quote&unique_id=rental';
    expect(carProtectionQuoteIdentity(original, 'autoeurope')).toBe(carProtectionQuoteIdentity(original.replace('/options?', '/checkout?'), 'autoeurope'));
    expect(carProtectionQuoteIdentity(original, 'autoeurope')).not.toBe(carProtectionQuoteIdentity(original.replace('unique_id=rental', 'unique_id=other'), 'autoeurope'));
    expect(() => carProtectionQuoteIdentity(`${original}&rate_reference=another`, 'autoeurope')).toThrow(/ambiguous/);
  });
});
