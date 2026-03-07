import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { parseFlightQuery } from '@/lib/scraper/parse-query';
import { prisma } from '@/lib/prisma';
import { hasValidInvite } from '@/lib/invite-auth';

export async function POST(request: NextRequest) {
  if (!(await hasValidInvite())) {
    return apiError('Invite code required', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body?.query || typeof body.query !== 'string') {
    return apiError('Missing or invalid "query" field', 400);
  }

  const rawInput = body.query.trim();
  if (rawInput.length < 5 || rawInput.length > 500) {
    return apiError('Query must be between 5 and 500 characters', 400);
  }

  const conversationHistory = Array.isArray(body.conversationHistory)
    ? body.conversationHistory as Array<{ role: 'user' | 'assistant'; content: string }>
    : undefined;

  try {
    const { response, usage } = await parseFlightQuery(rawInput, conversationHistory);

    // Log API usage for the parse call
    const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
    await prisma.apiUsageLog.create({
      data: {
        provider: config?.provider ?? 'anthropic',
        model: config?.model ?? 'claude-haiku-4-5-20251001',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: 0,
        operation: 'parse-query',
        durationMs: 0,
      },
    });

    return apiSuccess(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to parse query';
    return apiError(msg, 422);
  }
}
