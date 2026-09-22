import { NextRequest, NextResponse } from "next/server";
import { createAppToken, verifyPassword } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const password = body && typeof body === "object" && "password" in body ? body.password : undefined;
  if (!verifyPassword(password)) {
    return NextResponse.json({ error: "密码错误，请重新输入" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...createAppToken() });
}
