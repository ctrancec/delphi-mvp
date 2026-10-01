import type { Metadata, Viewport } from "next";
import { Inter, Pixelify_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { CookieConsent } from "@/components/legal/cookie-consent";
import { JuniorProvider } from "@/lib/contexts/junior-context";
import { APP_NAME, CEO_NAME } from "@/lib/pixel/cast/names";
import { SKY } from "@/lib/pixel/brand";

const inter = Inter({ subsets: ["latin"] });
// Self-hosted at build time like Inter; only the Pixel look reaches for it.
const pixel = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixel" });

export const metadata: Metadata = {
  title: APP_NAME,
  description: `Your AI CEO. Stand up a department, and ${CEO_NAME} hires the agents to run it.`,
  manifest: "/manifest.json",
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
  themeColor: SKY,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} ${pixel.variable}`}>
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
