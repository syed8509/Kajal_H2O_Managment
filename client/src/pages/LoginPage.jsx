import React, { useState } from "react";
import { Droplets } from "lucide-react";

export function Login({ onLogin, busy, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <Droplets size={30} />
        </div>
        <div className="eyebrow center">OWNER ACCESS</div>
        <h1>KAJAL H2O</h1>
        <p className="login-sub">Business Manager</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(email, password);
          }}
        >
          <label>Email address</label>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@example.com"
          />
          <label>Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
          {error && <div className="form-error">{error}</div>}
          <button className="primary full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in securely"}
          </button>
        </form>
        <small className="muted">Single-owner account • INR ledger</small>
      </div>
    </div>
  );
}
