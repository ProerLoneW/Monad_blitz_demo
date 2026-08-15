import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/source-serif-4";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "ProofNote — Content & impact credentials on Monad",
  description:
    "Notes with ownership anchored on Monad. Tips, stream support, impact evidence and campaign transparency.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
