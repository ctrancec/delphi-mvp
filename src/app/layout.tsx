import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { CookieConsent } from "@/components/legal/cookie-consent";
import { JuniorProvider } from "@/lib/contexts/junior-context";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Delphi",
  description: "Your AI CEO. Stand up a department, and Delphi hires the agents to run it.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
};

/**
 * Must be its own export. Next 16 ignores `viewport` inside `metadata`, and
 * dropping it would take `viewport-fit=cover` with it — which is what makes
 * env(safe-area-inset-*) resolve to anything but zero. The cover panel's tab
 * bar depends on that to clear the home indicator.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <JuniorProvider>
            {children}
            <CookieConsent />
          </JuniorProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
