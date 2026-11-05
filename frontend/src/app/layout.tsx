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
    default: "وثيقة | القوالب والمستندات",
    template: "%s | وثيقة"
  },
  applicationName: "وثيقة",
  description: "وثيقة منصة عربية لتصميم القوالب، تحرير العقود، حفظ المستندات وتصديرها",
  openGraph: {
    title: "وثيقة | القوالب والمستندات",
    description: "قوالب قابلة للتخصيص ومستندات مستقلة في مساحة عمل عربية."
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
