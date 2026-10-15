"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container stack">
      <h1>Something went wrong</h1>
      <p className="banner error" role="alert">{error.message || "Unexpected error."}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
