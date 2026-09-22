import { AuthGate } from "@/components/AuthGate";
import { Workspace } from "@/components/Workspace";

export default function Home() {
  return <AuthGate><Workspace /></AuthGate>;
}
