import { z } from "zod";
import { duplicateItemMessage } from "@/lib/shopping/list";
import { ShoppingListItemSchema, signShoppingList } from "@/lib/server/shopping-list";
import { setSignedList } from "@/lib/server/demo-state";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";
import { financialScopeFromRequest } from "@/lib/server/request-session";

const BodySchema = z.object({
  items: z.array(ShoppingListItemSchema).max(30),
});

/** The owner saves the allowlist. The response is the only list the Spend Guard will trust. */
export async function POST(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "shopping-list");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "Invalid shopping list. Each item needs a name, a max price in cents, and a quantity." },
      { status: 400 },
    );
  }
  const dup = duplicateItemMessage(body.data.items);
  if (dup) return Response.json({ error: dup }, { status: 400 });
  const signed = signShoppingList(body.data.items);
  const scopeId = financialScopeFromRequest(req);
  if (scopeId) await setSignedList(scopeId, signed);
  return withRemaining(Response.json(signed), remaining);
}
