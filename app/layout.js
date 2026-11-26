import "./styles.css";

export const metadata = {
  title: "Atoms Demo",
  description: "用自然语言生成可操作的网页应用。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
