import { createServer, type Server } from 'node:http';
import { createServer as smtpServer, type Server as SmtpServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sendWebhook } from './webhook';
import { sendEmail } from './email';
import type { ChannelMessage } from './types';

const message: ChannelMessage = { title: 'Verified rental target', body: 'GBP 100 total including verified extras.', url: 'https://www.discovercars.com/', data: { eventId: 'car:event:1' } };
let server: Server | SmtpServer | undefined;
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});
async function listen(value: Server | SmtpServer) {
  server = value;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => value.listen(0, '127.0.0.1', resolve));
  const address = value.address();
  if (!address || typeof address === 'string') throw new Error('Missing local transport address');
  return address.port;
}

describe('notification transport over local HTTP and SMTP', () => {
  it.each(['headers', 'body'])('cancels a hanging HTTP %s response and releases its connection', async phase => {
    const abort = new AbortController();
    let received!: () => void, closed!: () => void;
    const arrived = new Promise<void>(resolve => { received = resolve; });
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const port = await listen(createServer((request, response) => {
      request.socket.once('close', closed);
      if (phase === 'body') { response.writeHead(503); response.write('Partial error'); }
      received();
    }));
    const sending = sendWebhook({ url: `http://127.0.0.1:${port}` }, message, { trusted: true, signal: abort.signal });
    const rejected = expect(sending).rejects.toThrow();
    await arrived; abort.abort(new Error('Delivery cancelled'));
    await rejected; await disconnected;
  });
  it('bounds a streaming error page and preserves the provider status', async () => {
    const port = await listen(createServer((request, response) => { response.writeHead(503); response.write('x'.repeat(200_000)); }));
    const error = await sendWebhook({ url: `http://127.0.0.1:${port}` }, message).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/503/);
    expect((error as Error).message.length).toBeLessThan(250);
  });
  it('sends the stable event identity in an accepted webhook', async () => {
    let received = '';
    const port = await listen(createServer((request, response) => {
      request.setEncoding('utf8'); request.on('data', part => { received += part; });
      request.on('end', () => { response.writeHead(202); response.end('Accepted'); });
    }));
    await sendWebhook({ url: `http://127.0.0.1:${port}` }, message);
    expect(JSON.parse(received)).toMatchObject({ title: message.title, data: { eventId: 'car:event:1' } });
  });
  it('terminates an SMTP connection that never sends its greeting', async () => {
    const abort = new AbortController();
    let connected!: () => void, closed!: () => void;
    const arrived = new Promise<void>(resolve => { connected = resolve; });
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const port = await listen(smtpServer(socket => { socket.once('close', closed); connected(); }));
    const sending = sendEmail({ host: '127.0.0.1', port, secure: false, from: 'sender@example.test', to: 'owner@example.test' }, message, { trusted: true, signal: abort.signal });
    const rejected = expect(sending).rejects.toThrow();
    await arrived; abort.abort(new Error('Delivery cancelled'));
    await rejected; await disconnected;
  });
  it('delivers SMTP content through the canonical mailer with the owned socket', async () => {
    let content = '';
    const port = await listen(smtpServer(socket => {
      socket.setEncoding('utf8'); socket.write('220 localhost ESMTP\r\n');
      let buffered = '', data = false;
      socket.on('data', chunk => {
        buffered += chunk;
        for (;;) {
          const end = buffered.indexOf('\r\n'); if (end < 0) return;
          const line = buffered.slice(0, end); buffered = buffered.slice(end + 2);
          if (data) {
            if (line === '.') { data = false; socket.write('250 Accepted\r\n'); }
            else content += `${line}\n`;
          } else if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 PIPELINING\r\n');
          else if (line === 'DATA') { data = true; socket.write('354 Send content\r\n'); }
          else if (line === 'QUIT') socket.end('221 Bye\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    }));
    await sendEmail({ host: '127.0.0.1', port, secure: false, from: 'sender@example.test', to: 'owner@example.test' }, message);
    expect(content).toContain('Subject: Verified rental target');
    expect(content).toContain('To: owner@example.test');
    expect(content).toContain('GBP 100 total');
  });
});
