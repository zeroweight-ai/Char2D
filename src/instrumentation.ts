export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDatabase } = await import("./server/db");
    getDatabase();
  }
}
