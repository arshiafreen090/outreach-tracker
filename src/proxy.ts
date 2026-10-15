import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/auth-rules";

/**
 * Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session and
 * sends anyone who isn't the allowed user to /login. This is only the first
 * gate: pages call requireAuthed() and server actions re-check, because the
 * proxy does not run for every kind of request.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The Apps Script's endpoints authenticate themselves with the shared secret (no browser session).
  if (pathname === "/api/ingest" || pathname === "/api/ingest/ping" || pathname === "/api/sheet" || pathname === "/api/jobs/pull") return NextResponse.next();

  // Fixture-only UI preview, never reachable in production builds.
  if (process.env.NODE_ENV !== "production" && pathname.startsWith("/dev/")) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return new NextResponse(
      "Supabase is not configured. Copy .env.example to .env.local, fill it in and restart the server.",
      { status: 500 },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims() verifies the JWT signature; getSession() would only trust the cookie.
  const { data } = await supabase.auth.getClaims();
  const allowed = isAllowedEmail(data?.claims?.email, process.env.ALLOWED_EMAIL);
  const onLogin = pathname === "/login";

  if (!allowed && !onLogin) return NextResponse.redirect(new URL("/login", request.url));
  if (allowed && onLogin) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
