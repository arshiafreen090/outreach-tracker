import { verifyBearer } from "../ingest/auth";
import type { PullResult } from "./pull";

export interface PullHandlerDeps {
  secret: string | undefined;
  /** Runs the pull. Called only after the request is authenticated. */
  pull: () => Promise<PullResult[]>;
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** POST /api/jobs/pull: the daily trigger, called by the Gmail forwarder's Apps Script with the shared secret. */
export async function handlePull(request: Request, deps: PullHandlerDeps): Promise<Response> {
  if (!verifyBearer(request.headers.get("authorization"), deps.secret)) {
    return json(401, { ok: false, error: "Unauthorized." });
  }
  try {
    const results = await deps.pull();
    return json(200, {
      ok: true,
      sources: results.length,
      failed: results.filter((r) => !r.ok).length,
      added: results.reduce((n, r) => n + r.added, 0),
      results: results.map(({ kind, slug, ok, status, listed, relevant, added }) => ({ kind, slug, ok, status, listed, relevant, added })),
    });
  } catch {
    console.error("jobs: pull failed");
    return json(500, { ok: false, error: "Could not pull job sources." });
  }
}
