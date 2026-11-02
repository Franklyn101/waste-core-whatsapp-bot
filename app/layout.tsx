import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import Navbar from '@/components/navbar'

export const metadata: Metadata = {
  title: 'WasteCore',
  description: 'WasteCore admin dashboard',
  generator: 'WasteCore',
  // Lets admins install the dashboard (needed for notifications on iPhone).
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'WasteCore', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <div className='flex flex-col min-h-screen'>
          {children}
        <Analytics />
        </div>
        
      </body>
    </html>
  )
}
