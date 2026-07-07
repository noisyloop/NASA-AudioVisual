import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orrery — a NASA data audiovisual instrument",
  description:
    "Fireball impacts as percussion, exoplanets as drones: real NASA data played as a coupled audiovisual piece.",
};

export const viewport: Viewport = {
  themeColor: "#01030a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
