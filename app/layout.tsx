import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "fiyor₺X",
  description: "fiyor₺X — Kişisel para akışı, ödemeler ve birikim takibi.",
  icons: {
    icon: "/fiyor-logo.jpg",
    apple: "/fiyor-logo.jpg",
  },
};

export const viewport: Viewport = {
  themeColor: "#060d18",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-[#060d18] antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#060d18] text-white">
        {children}
      </body>
    </html>
  );
}
