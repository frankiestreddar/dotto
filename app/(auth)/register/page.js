"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth";

const inputStyle = {
  width: "100%",
  background: "#1a1a1a",
  border: "1px solid var(--card-border)",
  borderRadius: 8,
  color: "var(--ink)",
  padding: "10px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--ink-soft)" };

// Small green/red status dot shown inside a field once it's focused and has been typed into at
// least once — hovering a red dot reveals a short reason via .auth-validity-tooltip (see
// globals.css). Kept local to this file rather than a shared component — no shared component
// library exists for the auth pages, each one is self-contained.
function ValidityDot({ show, ok, reason }) {
  if (!show) return null;
  return (
    <div className={`auth-validity-dot ${ok ? "ok" : "bad"}`}>
      {!ok && reason ? <div className="auth-validity-tooltip">{reason}</div> : null}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [passwordFocused, setPasswordFocused] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [confirmFocused, setConfirmFocused] = useState(false);
  const [confirmDirty, setConfirmDirty] = useState(false);

  const passwordStrong = password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const passwordStatus = { ok: passwordStrong, reason: "too weak" };

  const confirmMatches = confirmPassword.length > 0 && confirmPassword === password;
  const confirmStatus = { ok: confirmMatches, reason: "doesn't match" };

  const canSubmit = passwordStatus.ok && confirmStatus.ok;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!canSubmit) return;

    setLoading(true);
    try {
      // No username here — the account is created with a temporary, auto-derived-from-email
      // username (see the handle_new_user DB trigger), and the user picks their real one on the
      // avatar-setup page right after, which updates it before landing on the canvas.
      const data = await signUp({ email, password });
      if (data.session) {
        // Email confirmation is off for this project, so signUp() already returned an active
        // session — no email to check. New accounts build their avatar (and pick a username)
        // before landing on the canvas.
        router.push("/avatar-setup");
        router.refresh();
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "Something went wrong signing up.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>Check your email</h1>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          We sent a confirmation link to <strong style={{ color: "var(--ink)" }}>{email}</strong>.
          Follow it to activate your account, then log in.
        </p>
        <p style={{ marginTop: 20, fontSize: 12 }}>
          <Link href="/login" style={{ color: "var(--brand)" }}>
            Back to login
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 24px" }}>Create your account</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={labelStyle}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Password
          <div style={{ position: "relative" }}>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPasswordDirty(true); }}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              style={inputStyle}
            />
            <ValidityDot show={passwordFocused && passwordDirty} ok={passwordStatus.ok} reason={passwordStatus.reason} />
          </div>
        </label>
        <label style={labelStyle}>
          Confirm password
          <div style={{ position: "relative" }}>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setConfirmDirty(true); }}
              onFocus={() => setConfirmFocused(true)}
              onBlur={() => setConfirmFocused(false)}
              style={inputStyle}
            />
            <ValidityDot show={confirmFocused && confirmDirty} ok={confirmStatus.ok} reason={confirmStatus.reason} />
          </div>
        </label>

        {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}

        <button
          type="submit"
          disabled={loading || !canSubmit}
          style={{
            marginTop: 8,
            height: 38,
            background: "var(--brand)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: loading || !canSubmit ? "default" : "pointer",
            opacity: loading || !canSubmit ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          {loading ? "Creating account…" : "Register"}
        </button>
      </form>

      <p style={{ marginTop: 20, fontSize: 12, color: "var(--ink-soft)" }}>
        Already have an account?{" "}
        <Link href="/login" style={{ color: "var(--brand)" }}>
          Log in
        </Link>
      </p>
    </>
  );
}
