import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The previous document-template editor has no tenant authentication. It is
// retained for local migration work, NOT as a public endpoint. The approved
// Wathiqa product is Import Management; production is import-only by default.
// Do not add a production env switch that re-enables the legacy public API.
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (path === "/") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/import";
    destination.search = "";
    return NextResponse.redirect(destination, 307);
  }

  // Restrict the public surface to the tenant-authenticated Import app and
  // the minimal Next.js assets needed to render it. These are route prefix
  // checks with exact segment boundaries, not a permissive startsWith('import').
  const allowed = path === "/import" || path.startsWith("/import/") ||
    path === "/import-api" || path.startsWith("/import-api/") ||
    path.startsWith("/_next/static/") || path.startsWith("/_next/image/") ||
    path === "/icon.svg" || path === "/favicon.ico";
  if (allowed) return NextResponse.next();

  return NextResponse.json(
    { error: "route_not_available" },
    { status: 404, headers: { "Cache-Control": "no-store" } }
  );
}

export const config = { matcher: "/:path*" };
