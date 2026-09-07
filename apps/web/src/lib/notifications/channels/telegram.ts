import type { ChannelMessage, TelegramConfig } from './types';
import { notificationDeadline, notificationPost, type NotificationTransportOptions } from './transport';

export async function sendTelegram(config: TelegramConfig, message: ChannelMessage, opts: NotificationTransportOptions = {}): Promise<void> {
  return notificationDeadline(async signal => {
    const endpoint = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const text = message.url
      ? `${message.title}\n\n${message.body}\n\n${message.url}`
      : `${message.title}\n\n${message.body}`;
    await notificationPost(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: false }),
    }, 'Telegram API', signal);
  }, opts.signal);
}
