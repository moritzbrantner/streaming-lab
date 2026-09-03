import type { Metadata } from "next"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Streaming Lab",
  description: "Interactive experiments for buffering, backpressure, unreliable networks, and adaptive media streaming.",
}

export default function RootLayout({children}: Readonly<{children: ReactNode}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
