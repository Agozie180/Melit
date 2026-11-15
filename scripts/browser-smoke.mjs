#!/usr/bin/env node
import { chromium } from "playwright";

const base = process.env.SMOKE_URL ?? "http://127.0.0.1:3001";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const card = page.getByTestId("shopping-list-card");
  await card.getByLabel("Shopping list item name").fill("Wireless Earbuds");
  await card.getByLabel("Shopping list max price in dollars").fill("120");
  await card.getByLabel("Shopping list quantity").fill("1");
  await card.getByRole("button", { name: "Add item" }).click();
  await card.locator("ul li", { hasText: "Wireless Earbuds" }).waitFor({ timeout: 10_000 });
  await card.getByRole("button", { name: "Save list" }).click();
  await page.getByTestId("shopping-list-badge").filter({ hasText: "signed" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: /Negotiate and buy/i }).click();
  await page.getByText(/Round|SERV Reasoning|Fallback heuristic/i).first().waitFor({ timeout: 120_000 });
  console.log("browser-smoke OK");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});