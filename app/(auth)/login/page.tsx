"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth";

const inputStyle: CSSProperties = {
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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn({ email, password });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong signing in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 24px" }}>Log in to Dotto</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            color: "var(--ink-soft)",
          }}
        >
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
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            color: "var(--ink-soft)",
          }}
        >
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 8,
            height: 38,
            background: "var(--brand)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.7 : 1,
            fontFamily: "inherit",
          }}
        >
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p style={{ marginTop: 20, fontSize: 12, color: "var(--ink-soft)" }}>
        Don&apos;t have an account?{" "}
        <Link href="/register" style={{ color: "var(--brand)" }}>
          Register
        </Link>
      </p>
    </>
  );
}
