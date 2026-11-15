import { runOverspend } from "@/lib/negotiation/run";
import { ndjsonResponse } from "@/lib/server/stream";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ledger?: unknown } | null;
  return ndjsonResponse(runOverspend(body?.ledger ?? []));
}
