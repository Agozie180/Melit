// SERVER-ONLY. Orders are issued only after the Spend Guard approves a purchase. The mock
// seller's x402 checkout refuses anything without a valid, unexpired token, so the paid
// endpoint can't be used to charge an arbitrary amount.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ledgerSecret } from "../server/ledger";
import type { PaymentOrder } from "./types";

const ORDER_TTL_MS = 10 * 60 * 1000;

const OrderSchema = z.object({
  orderId: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100),
  itemName: z.string().max(200),
  sellerId: z.string().min(1).max(100),
  priceCents: z.number().int().positive(),
  exp: z.number().int(),
});

function mac(payload: string, secret: string): string {
  return createHmac("sha256", `${secret}:order`).update(payload).digest("base64url");
}

export function signOrder(order: PaymentOrder, now = Date.now(), secret = ledgerSecret()): string {
  const payload = Buffer.from(JSON.stringify({ ...order, exp: now + ORDER_TTL_MS })).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyOrder(token: string | null | undefined, now = Date.now(), secret = ledgerSecret()): PaymentOrder | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = OrderSchema.safeParse(parsed);
  if (!result.success || result.data.exp < now) return null;
  const { exp: _exp, ...order } = result.data;
  void _exp;
  return order;
}
