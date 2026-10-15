"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/action-types";

export function LoginForm({ action }: { action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  // A real form action (not onSubmit) so the server action's redirect() navigates after sign-in.
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="card">
      <h1>Outreach Tracker</h1>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="banner error" role="alert">{state.error}</p>}
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
