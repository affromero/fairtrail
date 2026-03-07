import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { EXTRACTION_PROVIDERS } from '@/lib/scraper/ai-registry';
import { hashPassword } from '@/lib/password';

function stripHashes(config: Record<string, unknown>) {
  const { sitePasswordHash, adminPasswordHash, ...rest } = config;
  return {
    ...rest,
    hasSitePassword: !!sitePasswordHash,
    hasAdminPassword: !!adminPasswordHash,
  };
}

export async function GET() {
  const config = await prisma.extractionConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  return apiSuccess(stripHashes(config as unknown as Record<string, unknown>));
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const { provider, model } = body;

  if (provider) {
    const providerConfig = EXTRACTION_PROVIDERS[provider];
    if (!providerConfig) {
      return apiError(`Unknown provider: ${provider}`, 400);
    }

    if (model) {
      const validModel = providerConfig.models.find((m) => m.id === model);
      if (!validModel) {
        return apiError(`Invalid model "${model}" for provider "${provider}"`, 400);
      }
    }
  }

  const data: Record<string, unknown> = {};
  if (provider) data.provider = provider;
  if (model) data.model = model;
  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
  if (typeof body.scrapeIntervalHours === 'number') {
    data.scrapeInterval = Math.max(1, Math.min(24, Math.round(body.scrapeIntervalHours)));
  }
  if (typeof body.siteGateEnabled === 'boolean') {
    data.siteGateEnabled = body.siteGateEnabled;
  }
  if (typeof body.sitePassword === 'string' && body.sitePassword.length > 0) {
    data.sitePasswordHash = await hashPassword(body.sitePassword);
  }
  if (typeof body.adminPassword === 'string' && body.adminPassword.length > 0) {
    data.adminPasswordHash = await hashPassword(body.adminPassword);
  }

  const config = await prisma.extractionConfig.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });

  const response = apiSuccess(stripHashes(config as unknown as Record<string, unknown>));

  // Set or clear the ft-gate-active cookie based on gate state
  const gateEnabled = (config as unknown as Record<string, unknown>).siteGateEnabled as boolean;
  const hasSitePassword = !!(config as unknown as Record<string, unknown>).sitePasswordHash;

  if (gateEnabled && hasSitePassword) {
    response.cookies.set('ft-gate-active', '1', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
  } else {
    response.cookies.delete('ft-gate-active');
  }

  return response;
}
