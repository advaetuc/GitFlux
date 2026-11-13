import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REGISTERED_COMMANDS,
  VIEW_ID,
  CONFIG_KEYS,
} from "../../src/host/ids";

interface ManifestPackage {
  contributes?: {
    commands?: Array<{ command: string }>;
    views?: { scm?: Array<{ id: string }> };
    menus?: Record<string, unknown>;
    configuration?: { properties?: Record<string, unknown> };
    [key: string]: unknown;
  };
}

describe("Manifest Consistency (AM-07)", () => {
  const pkgPath = resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as ManifestPackage;
  const contributes = pkg.contributes;

  it("asserts contributes exists and only has allowed sections", () => {
    expect(contributes).toBeDefined();
    if (!contributes) return;

    const allowedSections = ["commands", "views", "menus", "configuration"];
    const actualSections = Object.keys(contributes);
    expect(actualSections.sort()).toEqual(allowedSections.sort());
  });

  it("asserts every command in contributes equals a value in ids.ts REGISTERED_COMMANDS", () => {
    const commands = contributes?.commands?.map((c) => c.command) ?? [];
    expect(commands.sort()).toEqual([...REGISTERED_COMMANDS].sort());
  });

  it("asserts views.scm view id equals VIEW_ID from ids.ts", () => {
    const scmViews = contributes?.views?.scm ?? [];
    expect(scmViews).toHaveLength(1);
    const view0 = scmViews[0];
    expect(view0).toBeDefined();
    if (!view0) return;
    expect(view0.id).toBe(VIEW_ID);
  });

  it("asserts configuration.properties keys equal CONFIG_KEYS from ids.ts", () => {
    const props = Object.keys(contributes?.configuration?.properties ?? {});
    expect(props.sort()).toEqual([...CONFIG_KEYS].sort());
  });

  it("asserts every command in the manifest is registered in extension.ts", () => {
    const extPath = resolve(__dirname, "../../src/host/extension.ts");
    const extContent = readFileSync(extPath, "utf8");
    expect(extContent.includes("REGISTERED_COMMANDS")).toBe(true);
    expect(extContent.includes("registerCommand")).toBe(true);
    const manifestCommands = contributes?.commands?.map((c) => c.command) ?? [];
    for (const cmd of manifestCommands) {
      expect(REGISTERED_COMMANDS).toContain(cmd);
    }
  });
});
