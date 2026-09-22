import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./login.css";

const themeInitializer = `
(() => {
  try {
    const preference = window.localStorage.getItem("study-log-theme");
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = preference === "dark" || (preference !== "light" && systemDark) ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
})();
`;

export const metadata: Metadata = {
  title: "学习日志工作台",
  description: "自部署 Markdown 学习日志工作台"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
