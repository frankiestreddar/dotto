import "./globals.css";

export const metadata = {
  title: "Dotter v0.1.3",
  description: "Dotto — infinite-canvas study/notes app",
};

// Phase 1 "lift and shim": replicate the original Dotto.html <head> assets
// (Google Fonts preconnect + heading stylesheet) as-is. Next.js hoists
// <link>/<meta> elements rendered anywhere in the tree into the real <head>,
// so this is behaviorally identical to the original static markup.
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
