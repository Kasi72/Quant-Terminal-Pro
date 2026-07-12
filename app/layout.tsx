import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Keepalive from '@/components/Keepalive';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Momentum Screener — Compression Breakout",
  description: "Screen stocks for compression breakout setups using 4 optimized cluster models",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Keepalive />
        {children}
      </body>
    </html>
  );
}
