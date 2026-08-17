import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yu's Atlas",
  description: "A local-first personal travel atlas.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
