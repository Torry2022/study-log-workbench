import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "学习日志工作台",
  description: "自部署 Markdown 学习日志工作台"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
