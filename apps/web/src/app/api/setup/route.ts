import { prisma } from '@/lib/prisma';
import { apiSuccess, apiError } from '@/lib/api-response';
import { hashPassword } from '@/lib/password';
import { registerForCommunity } from '@/lib/community-sync';

export async function POST(request: Request) {
  // Only allow setup if no config exists yet
  const existing = await prisma.extractionConfig.findFirst({
    where: { id: 'singleton' },
  });

  if (existing?.adminPasswordHash) {
    return apiError('Setup already completed. Use admin panel to change settings.', 403);
  }

  const body = await request.json();
  const { adminPassword, provider, model, communitySharing, customBaseUrl } = body as {
    adminPassword: string;
    provider: string;
    model: string;
    communitySharing?: boolean;
    customBaseUrl?: string | null;
  };

  const isSelfHosted = process.env.SELF_HOSTED === 'true';

  if (!isSelfHosted && (!adminPassword || adminPassword.length < 8)) {
    return apiError('Password must be at least 8 characters', 400);
  }

  if (!provider || !model) {
    return apiError('Provider and model are required', 400);
  }

  const passwordHash = isSelfHosted
    ? 'self-hosted'
    : await hashPassword(adminPassword);

  // Register for community API key if opted in
  let communityApiKey: string | null = null;
  if (communitySharing) {
    try {
      communityApiKey = await registerForCommunity();
    } catch (err) {
      console.error('[setup] Community registration failed:', err instanceof Error ? err.message : err);
      // Non-fatal — setup continues without community sharing
    }
  }

  await prisma.extractionConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      provider,
      model,
      adminPasswordHash: passwordHash,
      communitySharing: communitySharing && communityApiKey !== null,
      communityApiKey,
      customBaseUrl: customBaseUrl || null,
    },
    update: {
      provider,
      model,
      adminPasswordHash: passwordHash,
      communitySharing: communitySharing && communityApiKey !== null,
      communityApiKey,
      customBaseUrl: customBaseUrl || null,
    },
  });

  return apiSuccess({ message: 'Setup complete' });
}
