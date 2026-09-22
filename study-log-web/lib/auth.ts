import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppPassword, getCookieSecure, getSessionSecret } from "@/lib/config";

const COOKIE_NAME = "study_log_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const APP_TOKEN_AUDIENCE = "study-log-app";

interface SessionPayload {
  exp: number;
  sub: "owner";
  aud?: never;
}

interface AppTokenPayload {
  exp: number;
  sub: "owner";
  aud: typeof APP_TOKEN_AUDIENCE;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPassword(password: unknown): boolean {
  if (typeof password !== "string") return false;
  const expected = getAppPassword();
  if (!expected) return false;
  return safeEqual(password, expected);
}

export function createSessionToken(): string {
  const payload: SessionPayload = {
    sub: "owner",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function createAppToken(): { token: string; expiresAt: string } {
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload: AppTokenPayload = {
    sub: "owner",
    aud: APP_TOKEN_AUDIENCE,
    exp: expiresAtSeconds
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${body}.${sign(body)}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
  };
}

function readSignedPayload(token: string): unknown | null {
  if (token.split(".").length !== 2) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function isActiveOwner(payload: unknown): payload is { sub: "owner"; exp: number } {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as { sub?: unknown; exp?: unknown };
  return value.sub === "owner"
    && typeof value.exp === "number"
    && Number.isFinite(value.exp)
    && value.exp > Math.floor(Date.now() / 1000);
}

function isCookieAuthenticated(request: NextRequest): boolean {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const payload = readSignedPayload(token);
  return isActiveOwner(payload)
    && !("aud" in payload);
}

function isAppTokenAuthenticated(request: NextRequest): boolean {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const payload = readSignedPayload(match[1]);
  return isActiveOwner(payload)
    && "aud" in payload
    && payload.aud === APP_TOKEN_AUDIENCE;
}

export function isAuthenticated(request: NextRequest): boolean {
  return isCookieAuthenticated(request) || isAppTokenAuthenticated(request);
}

export function setSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: getCookieSecure(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: getCookieSecure(),
    path: "/",
    maxAge: 0
  });
}

export function requireAuth(request: NextRequest): NextResponse | null {
  if (isAuthenticated(request)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
