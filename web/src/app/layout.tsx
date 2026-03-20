import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://mpp.autonymlabs.org";
const siteName = "UnstoppableMPP";
const siteDescription =
  "Decentralized API marketplace for sovereign agents. Buy and sell OpenAI API access and ChatGPT Codex credits with USDC micropayments. No accounts, no KYC — just pay and use.";

export const metadata: Metadata = {
  title: {
    default: `${siteName} — Unstoppable API Marketplace`,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  keywords: [
    "OpenAI API",
    "Codex",
    "ChatGPT",
    "API marketplace",
    "micropayments",
    "USDC",
    "Tempo",
    "sovereign agents",
    "decentralized",
    "GPT-5",
    "gpt-5.3-codex",
    "gpt-5.4",
    "pay-per-token",
  ],
  authors: [{ name: "UnstoppableMPP" }],
  creator: "UnstoppableMPP",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName,
    title: `${siteName} — Unstoppable API Marketplace for Sovereign Agents`,
    description: siteDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} — Unstoppable API Marketplace`,
    description: siteDescription,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
