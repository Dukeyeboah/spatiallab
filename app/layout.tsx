import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spatial Lab",
  description: "A small laboratory for learning about LiDAR point clouds and spatial computing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
