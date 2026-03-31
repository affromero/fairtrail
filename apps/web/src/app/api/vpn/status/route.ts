import { apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });

  const vpnProvider = config?.vpnProvider ?? 'none';
  const hasActivationCode = !!config?.vpnActivationCode;
  const isConfigured = vpnProvider !== 'none' && hasActivationCode;

  // Check if the sidecar is reachable
  let sidecarReachable = false;
  if (isConfigured) {
    try {
      const apiUrl = process.env.EXPRESSVPN_API_URL || 'http://expressvpn:8000';
      const res = await fetch(`${apiUrl}/v1/status`, { signal: AbortSignal.timeout(3000) });
      sidecarReachable = res.ok;
    } catch {
      // Sidecar not running
    }
  }

  return apiSuccess({
    provider: vpnProvider,
    configured: isConfigured,
    sidecarRunning: sidecarReachable,
    ready: isConfigured && sidecarReachable,
  });
}
