// Layout raiz do painel. Mantemos minimo: o app eh SPA-like (uma tela so
// no MVP) entao nao precisa de header/footer global.
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Watch Party - Painel do Streamer",
  description: "Compartilhe tela e webcam pra watch party sincronizada",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
