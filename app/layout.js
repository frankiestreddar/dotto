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
        {/* Applies the persisted light/dark theme (see theme-toggle.js) to <html> synchronously,
            before anything paints — this app's vanilla-JS bootstrap (dotto-script.js) loads via
            <Script strategy="afterInteractive"> in dotto-app.jsx, well after hydration, which
            would otherwise mean a visible flash of the wrong theme on every load. Deliberately a
            plain blocking <script> (no async/defer/type=module) so it runs synchronously as the
            browser parses this <head>, before <body> renders. Wrapped in try/catch since
            localStorage can throw in some private-browsing configurations — falls back to dark,
            the app's default, exactly like theme-toggle.js's own first-run default does. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.dataset.theme=localStorage.getItem('dotto-theme')==='light'?'light':'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`,
          }}
        />
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
