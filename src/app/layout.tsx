import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { BottomNav, TopNavDesktop } from "@/components/BottomNav"
import { MarketProvider } from "@/components/MarketContext"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
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
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="h-full font-sans">
        <MarketProvider>
          <TopNavDesktop />
          {children}
          <BottomNav />
        </MarketProvider>
      </body>
    </html>
  )
}
