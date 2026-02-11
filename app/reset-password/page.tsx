"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ViewState = "loading" | "ready" | "invalid" | "submitting" | "done";

export default function ResetPasswordPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [message, setMessage] = useState<string>("Checking reset link...");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const envMissing = useMemo(() => {
    return !supabaseUrl || !supabaseAnonKey;
  }, [supabaseUrl, supabaseAnonKey]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (envMissing) {
        if (!cancelled) {
          setState("invalid");
          setMessage("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        }
        return;
      }

      const supabase = createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      if (!cancelled) setClient(supabase);

      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error || !data.session) {
        setState("invalid");
        setMessage("Reset link is invalid or expired. Please request a new one.");
        return;
      }

      setState("ready");
      setMessage("Please enter your new password.");
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [envMissing, supabaseAnonKey, supabaseUrl]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setState("submitting");
    setMessage("Updating password...");

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setState("ready");
      setMessage(error.message || "Failed to update password.");
      return;
    }

    setState("done");
    setMessage("Password updated successfully. You can now sign in.");
  }

  return (
    <main className="container" style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <div className="card formCard">
        <h1 className="sectionTitle" style={{ marginTop: 6 }}>Reset Password</h1>
        <p style={{ opacity: 0.85, marginTop: 8 }}>{message}</p>

        {state === "ready" || state === "submitting" ? (
          <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>New Password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <label className="field">
              <span className="kvLabel" style={{ textTransform: "none" }}>Confirm Password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                type="submit"
                className={`btn ${state === "submitting" ? "" : "btnPrimary"}`}
                disabled={state === "submitting"}
              >
                {state === "submitting" ? "Updating..." : "Update Password"}
              </button>
              <Link href="/login" className="btn">Back to Login</Link>
            </div>
          </form>
        ) : null}

        {state === "invalid" || state === "done" ? (
          <div className="actions" style={{ marginTop: 14 }}>
            <Link href="/login" className="btn btnPrimary">Go to Login</Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}