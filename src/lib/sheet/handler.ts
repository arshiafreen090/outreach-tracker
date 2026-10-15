import { verifyBearer } from "../ingest/auth";
import { buildSheetTabs, type SheetData } from "./build";

export interface SheetDeps {
  secret: string | undefined;
  /** Loads everything the tabs need. Called only after the request is authenticated. */
  load: () => Promise<SheetData>;
  now?: () => Date;
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/sheet: the data for the Google Sheet mirror. Called by the Sheet's Apps Script with the
 * shared secret (the same one the Gmail forwarder uses). Read-only, never cached.
 */
export async function handleSheet(request: Request, deps: SheetDeps): Promise<Response> {
  if (!verifyBearer(request.headers.get("authorization"), deps.secret)) {
    return json(401, { ok: false, error: "Unauthorized." });
  }
  try {
    const now = deps.now?.() ?? new Date();
    const tabs = buildSheetTabs(await deps.load(), now);
    return json(200, { ok: true, generatedAt: now.toISOString(), tabs });
  } catch {
    console.error("sheet: could not build the tabs");
    return json(500, { ok: false, error: "Could not build the sheet data." });
  }
}
