export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        overflowY: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--paper)",
        // Same dotted grid as the main canvas (#dot-layer in globals.css) and the avatar builder
        // (.avatar-setup-shell) — inline here since this page uses no CSS classes at all.
        backgroundImage: "radial-gradient(var(--dot) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--card)",
          border: "1px solid var(--card-border)",
          borderRadius: 16,
          padding: "32px 28px",
        }}
      >
        {children}
      </div>
    </div>
  );
}
