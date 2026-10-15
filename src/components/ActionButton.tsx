"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-types";

/** A button that runs a server action and shows its error inline. */
export function ActionButton({
  action,
  children,
  className = "btn",
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action();
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Working…" : children}
      </button>
      {error && (
        <p className="banner error" role="alert" style={{ flexBasis: "100%" }}>
          {error}
        </p>
      )}
    </>
  );
}
