import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Guards docs/01 §5: the engine stays pure and transcendental-free. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("sim/ purity", () => {
  const files = walk(join(__dirname, "..", "src", "sim"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  for (const f of files) {
    it(`${f.split("/src/")[1]} has no forbidden calls or imports`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/Math\.random\s*\(/);
      expect(src).not.toMatch(/Date\.now\s*\(/);
      expect(src).not.toMatch(/Math\.(sin|cos|tan|exp|pow|log|log2|log10|atan2|cbrt)\s*\(/);
      expect(src).not.toMatch(/from\s+["']\.\.\/(app|render|workers|storage|ai)\//);
      expect(src).not.toMatch(/from\s+["']pixi\.js|from\s+["']react/);
    });
  }
});
