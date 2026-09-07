import type { Dispatcher } from 'undici';
import type { ChannelMessage, NtfyConfig } from './types';
import { pinnedPublicDispatcher } from './config';
import { notificationBoundary, notificationDeadline, notificationPost, type NotificationTransportOptions } from './transport';

type FetchInit = RequestInit & { dispatcher?: Dispatcher };

export async function sendNtfy(
  config: NtfyConfig,
  message: ChannelMessage,
  opts: { trusted: boolean } & NotificationTransportOptions = { trusted: true },
): Promise<void> {
  return notificationDeadline(async signal => {
    const base = (config.server || 'https://ntfy.sh').replace(/\/+$/, '');
    // Untrusted (per-user) channels may not aim a custom ntfy server at internal
    // hosts. The default ntfy.sh is public, so only check a custom base. For a
    // custom host this resolves, validates, and pins the socket (rebind-safe).
    let dispatcher: Dispatcher | undefined;
    if (base !== 'https://ntfy.sh') {
      dispatcher = await notificationBoundary(pinnedPublicDispatcher(base, { trusted: opts.trusted, signal }), signal);
    }
    try {
      const endpoint = `${base}/${encodeURIComponent(config.topic)}`;
      const headers: Record<string, string> = {
        // ntfy header values must be latin-1 safe — strip anything outside ASCII.
        Title: message.title.replace(/[^\x20-\x7E]/g, ''),
        Tags: 'airplane',
      };
      if (message.url) headers.Click = message.url;
      if (config.token) headers.Authorization = `Bearer ${config.token}`;
      const init: FetchInit = { method: 'POST', headers, body: message.body };
      if (dispatcher) init.dispatcher = dispatcher;
      // Pinning only validates the INITIAL host. A public host could still 307/308
      // redirect an untrusted channel to an internal target (localhost, the cloud
      // metadata IP), and that redirect host is not re-checked. Reject any redirect
      // for untrusted channels; trusted/global channels keep default following.
      if (!opts.trusted) init.redirect = 'error';
      await notificationPost(endpoint, init, 'ntfy', signal);
    } finally { await dispatcher?.destroy(); }
  }, opts.signal);
}
