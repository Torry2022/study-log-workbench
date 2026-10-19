export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build" && process.env.LOG_ROOT) {
    const { startRagTaskRuntime } = await import("./lib/rag-task-runtime");
    startRagTaskRuntime();
  }
}
