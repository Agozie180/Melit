import type { FeedEvent } from "../types";

/** Streams feed events as newline-delimited JSON so the UI can render rounds as they happen. */
export function ndjsonResponse(events: AsyncGenerator<FeedEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        console.error("[melit] stream failed", err);
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: "Melit hit an unexpected error. Nothing was bought." }) + "\n"));
      }
      controller.enqueue(encoder.encode(JSON.stringify({ type: "done" }) + "\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
