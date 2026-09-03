import type { Metadata } from "next";
import "./globals.css";

// Static fallback shown server-side and before hydration — DottoApp (dotto-app.jsx) overwrites
// this client-side with "Dotto | @username" once the logged-in user is known (that part can't be
// resolved here, a plain metadata export with no access to session/auth state), per explicit
// request to replace the old "Dotter v0.1.3" placeholder title.
export const metadata: Metadata = {
  title: "Dotto",
  description: "Dotto — infinite-canvas study/notes app",
};

// Phase 1 "lift and shim": replicate the original Dotto.html <head> assets
// (Google Fonts preconnect + heading stylesheet) as-is. Next.js hoists
// <link>/<meta> elements rendered anywhere in the tree into the real <head>,
// so this is behaviorally identical to the original static markup.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* suppressHydrationWarning above: the inline script below deliberately sets data-theme on
            <html> before React hydrates, so its attributes will legitimately differ from what got
            server-rendered (which has no data-theme at all — there's no request-time way to know
            the visitor's localStorage value, let alone their OS colour-scheme preference) —
            exactly the "external changing data" case React's own hydration-mismatch warning
            describes, and exactly what that prop exists for. Scoped to just this one
            element/attribute, not a blanket suppression.
            Applies the theme to <html> synchronously, before anything paints — the real switch
            (app/dotto/lib/themeToggle.ts) only wires up from a useEffect (HamburgerMenu.jsx),
            which fires well after hydration, which would otherwise mean a visible flash of the
            wrong theme on every load. Deliberately a plain blocking <script> (no
            async/defer/type=module) so it runs synchronously as the browser parses this <head>,
            before <body> renders.
            Explicit request: the site should follow the OS light/dark preference live, but a
            choice made via the Settings switch or the \ shortcut (see
            app/dotto/lib/themeToggle.ts's own setTheme/toggleTheme) always wins over that until
            cleared. localStorage's 'dotto-theme' key is used ONLY to record that explicit
            override — its mere presence (not just its value) is what "an override exists" means,
            so an unset key here means "no explicit choice yet, use the live OS preference" rather
            than defaulting to a fixed theme. Wrapped in try/catch since localStorage/matchMedia
            can throw or be unavailable in some private-browsing configurations — falls back to
            dark, matching app/dotto/lib/themeToggle.ts's own fallback for the same case. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('dotto-theme');document.documentElement.dataset.theme=(s==='light'||s==='dark')?s:((window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark');}catch(e){document.documentElement.dataset.theme='dark';}})();`,
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
