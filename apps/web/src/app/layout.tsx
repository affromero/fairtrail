import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { ClientBeacon } from '@/components/analytics/ClientBeacon';

const isSelfHosted = process.env.SELF_HOSTED === 'true';

export const metadata: Metadata = {
  metadataBase: new URL('https://fairtrail.org'),
  title: {
    default: 'Fairtrail — The price trail airlines don\'t show you',
    template: '%s | Fairtrail',
  },
  description:
    'Track flight prices over time with shareable charts. See how fares evolve, compare airlines, and book at the right moment.',
  openGraph: {
    title: 'Fairtrail — The price trail airlines don\'t show you',
    description:
      'Track flight prices over time with shareable charts. See how fares evolve, compare airlines, and book at the right moment.',
    siteName: 'Fairtrail',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Fairtrail',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#080f1a' },
    { media: '(prefers-color-scheme: light)', color: '#f5f2ec' },
  ],
};

const themeScript = `
  (function() {
    var t = localStorage.getItem('ft-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
  })();
`;

const swScript = `
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </head>
      <body>
        {children}
        {!isSelfHosted && <ClientBeacon />}
      </body>
    </html>
  );
}
