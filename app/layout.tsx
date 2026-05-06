import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HandiWay",
  description: "Carte collaborative pour signaler les obstacles urbains et préparer des trajets accessibles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
