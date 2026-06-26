import type { Metadata } from "next"
// 自托管 geist 包(next/font/local,字体文件随包打进 bundle),不在 build 期
// 向 Google Fonts 拉取——家服对 fonts.googleapis.com 的出口偶发被重置会让
// next/font/google 直接构建失败(SSL EOF)。变量名与原 --font-geist-* 一致。
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"

export const metadata: Metadata = {
  title: "Jiaxu Portal",
  description: "Personal home server dashboard",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} dark h-full`}
    >
      <body className="min-h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
