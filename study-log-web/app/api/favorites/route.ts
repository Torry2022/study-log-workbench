import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { addFavorite, createFavoriteGroup, FavoriteInputError, listFavoritesSnapshot, removeFavorite,
  removeFavoriteGroup, renameFavoriteGroup, setFavoriteGroupMembership, updateFavoriteGroups } from "@/lib/favorites-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof FavoriteInputError ? error.message : "收藏操作失败，请检查相关文件后重试" },
    { status: error instanceof FavoriteInputError ? 400 : 500, headers });
}
async function body(request: NextRequest): Promise<Record<string, unknown>> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new FavoriteInputError("请求正文必须是有效JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FavoriteInputError("请求内容无效，请刷新后重试");
  return value as Record<string, unknown>;
}
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try { return Response.json(await listFavoritesSnapshot(), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const input = await body(request);
    if (input.action === "createGroup") return Response.json({ group: await createFavoriteGroup(string(input.name)) }, { headers });
    if (input.action !== undefined) throw new FavoriteInputError("不支持的收藏操作");
    return Response.json({ favorite: await addFavorite({ date: string(input.date), headingText: string(input.headingText),
      headingId: string(input.headingId), level: typeof input.level === "number" ? input.level : 0 }) }, { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const input = await body(request);
    if (input.action === "renameGroup") return Response.json({ group: await renameFavoriteGroup(string(input.groupId), string(input.name)) }, { headers });
    if (input.action === "setGroup") return Response.json({ favorite: await setFavoriteGroupMembership(string(input.id), string(input.groupId), input.selected) }, { headers });
    if (input.action !== undefined) throw new FavoriteInputError("不支持的收藏操作");
    return Response.json({ favorite: await updateFavoriteGroups(string(input.id), input.groupIds) }, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: NextRequest) {
  const unauthorized = requireAuth(request); if (unauthorized) return unauthorized;
  try {
    const groupId = request.nextUrl.searchParams.get("groupId"), id = request.nextUrl.searchParams.get("id");
    if (groupId && id) throw new FavoriteInputError("请选择一个删除目标");
    if (groupId) await removeFavoriteGroup(groupId); else await removeFavorite(id || "");
    return Response.json({ ok: true }, { headers });
  } catch (error) { return failure(error); }
}
