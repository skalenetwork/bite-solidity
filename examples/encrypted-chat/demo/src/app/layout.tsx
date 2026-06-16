import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Encrypted Chat Demo",
    description: "BITE Encrypted Messenger Demo",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
