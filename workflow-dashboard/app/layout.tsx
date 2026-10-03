import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Messenger Live Workflow',
  description: 'Live execution dashboard for the Facebook Messenger chatbot',
  icons: { icon: '/favicon.svg' }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
