import "./platform.css";
import "../engtex-theme.css";

export const metadata = {
  title: "التحكم بالمنصة | وثيقة",
  robots: { index: false, follow: false }
};

export default function PlatformLayout({children}: {children:React.ReactNode}) {
  return <>{children}</>;
}
