import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Продавливание — расчёт плит по СП 63",
  description: "Интерактивная проверка монолитных железобетонных плит на продавливание у колонн и стен.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
