import crypto from 'crypto';
import type { Dispatcher } from 'undici';
import type { ChannelMessage, WebhookConfig } from './types';
import { pinnedPublicDispatcher } from './config';
import { notificationBoundary, notificationDeadline, notificationPost, type NotificationTransportOptions } from './transport';

type FetchInit = RequestInit & { dispatcher?: Dispatcher };

export async function sendWebhook(
  config: WebhookConfig,
  message: ChannelMessage,
  opts: { trusted: boolean } & NotificationTransportOptions = { trusted: true },
): Promise<void> {
  return notificationDeadline(async signal => {
    // Untrusted (per-user) channels may not point a webhook at internal hosts.
    // For a hostname this resolves and validates the address, then pins the socket
    // to it so the connection cannot rebind to an internal IP after the check.
    const dispatcher = await notificationBoundary(pinnedPublicDispatcher(config.url, { trusted: opts.trusted, signal }), signal);
    try {
      const payload = JSON.stringify({
        title: message.title,
        body: message.body,
        url: message.url,
        data: message.data,
      });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.secret) {
        const sig = crypto.createHmac('sha256', config.secret).update(payload).digest('hex');
        headers['X-Signature-256'] = `sha256=${sig}`;
      }
      const init: FetchInit = { method: 'POST', headers, body: payload };
      if (dispatcher) init.dispatcher = dispatcher;
      // Pinning only validates the INITIAL host. A public host could still 307/308
      // redirect an untrusted channel to an internal target (localhost, the cloud
      // metadata IP), and that redirect host is not re-checked. Reject any redirect
      // for untrusted channels; trusted/global channels keep default following.
      if (!opts.trusted) init.redirect = 'error';
      await notificationPost(config.url, init, 'Webhook', signal);
    } finally { await dispatcher?.destroy(); }
  }, opts.signal);
}
