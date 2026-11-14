import { NextRequest } from "next/server";
import { authorizeSettingsMutation, readSettingsOperation, settingsFailure, verifySettingsIdentity } from "@/lib/ai-settings-operation";
import { deploymentSnapshot } from "@/lib/ai-deployment-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    authorizeSettingsMutation(request);
    const { instanceId, current } = await readSettingsOperation(request);
    const snapshot = deploymentSnapshot(instanceId);
    authorizeSettingsMutation(request); await verifySettingsIdentity(instanceId);
    return Response.json({ instanceId, revision: current.revision, previewId: snapshot.previewId, ...snapshot.summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return settingsFailure(error); }
}
