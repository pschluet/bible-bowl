import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '@aws-amplify/ui-react/styles.css';
import './globals.css';
import ConfigureAmplify from '@/app/amplify-config';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Bible Bowl',
  description: 'Live Bible Bowl Scoring',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <ConfigureAmplify />
        {children}
      </body>
    </html>
  );
}
