import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { BottomNav, TopNavDesktop } from "@/components/BottomNav"
import { MarketProvider } from "@/components/MarketContext"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Main Street Market",
  description: "Follow the makers you meet at your local farmers market. Every dollar you spend here stays here.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <MarketProvider>
          <TopNavDesktop />
          {children}
          <BottomNav />
        </MarketProvider>
      </body>
    </html>
  )
}
