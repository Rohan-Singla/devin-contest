import type { Metadata } from 'next'
import './globals.css'
import { Geist, Geist_Mono } from 'next/font/google'
import { cn } from '@/lib/utils'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'mini-devin',
  description: 'Autonomous agents that build and modify codebases in parallel',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('dark font-sans', geist.variable, geistMono.variable)}>
      <body className="h-screen overflow-hidden bg-background text-foreground text-sm antialiased">
        {children}
      </body>
    </html>
  )
}
