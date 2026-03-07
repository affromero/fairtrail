import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { EXTRACTION_PROVIDERS } from '@/lib/scraper/ai-registry';

export async function GET() {
  const config = await prisma.extractionConfig.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  return apiSuccess(config);
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

  const config = await prisma.extractionConfig.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });

  return apiSuccess(config);
}
