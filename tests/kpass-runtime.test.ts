import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledKpassPath, prepareKpassRuntime, resolveKpassBinary } from "../lib/kite/kpass-runtime";

const tmp = join("/tmp", "melit-kpass-runtime-test");

describe("kpass runtime", () => {
  afterEach(() => {
    delete process.env.KPASS_RUNTIME_BUNDLE_B64;
    delete process.env.KPASS_WORKDIR;
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("resolveKpassBinary prefers bundled vendor binary when present", () => {
    const vendor = bundledKpassPath();
    if (vendor) {
      expect(resolveKpassBinary()).toBe(vendor);
    }
  });

  it("extracts KPASS_RUNTIME_BUNDLE_B64 into a workdir", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "config.json"), JSON.stringify({ probe: true }));
    const archive = join(tmp, "bundle.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", tmp, "config.json"]);
    const b64 = execFileSync("base64", ["-w0", archive], { encoding: "utf8" });
    const work = join(tmp, "work");
    process.env.KPASS_RUNTIME_BUNDLE_B64 = b64;
    process.env.KPASS_WORKDIR = work;
    const dir = prepareKpassRuntime();
    expect(dir).toBe(work);
    expect(existsSync(join(work, "config.json"))).toBe(true);
    chmodSync(work, 0o700);
  });
});