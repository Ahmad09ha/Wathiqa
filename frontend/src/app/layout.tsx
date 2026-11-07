import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "lenis/dist/lenis.css";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: {
    default: "وثيقة | إدارة الاستيراد والمنصة",
    template: "%s | وثيقة"
  },
  applicationName: "وثيقة",
  description: "وثيقة منصة عربية لإدارة الاستيراد والشحنات والمستندات، مع لوحة إدارة خاصة بالمنصة",
  openGraph: {
    title: "وثيقة | إدارة الاستيراد",
    description: "منصة عربية لإدارة طلبات الاستيراد والشحنات والمستندات."
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <SmoothScroll />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
