/**
 * Packages Extension
 *
 * Adds a /packages command that lists installed pi packages
 * (from settings.json) and local extensions (~/.pi/agent/extensions).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function installedPackages(): string[] {
	try {
		const settings = JSON.parse(readFileSync(join(agentDir(), "settings.json"), "utf8"));
		const pkgs = settings.packages ?? [];
		return pkgs.map((p: unknown) => (typeof p === "string" ? p : (p as { source: string }).source));
	} catch {
		return [];
	}
}

function localExtensions(): string[] {
	try {
		return readdirSync(join(agentDir(), "extensions"))
			.filter((f) => f.endsWith(".ts"))
			.sort();
	} catch {
		return [];
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("packages", {
		description: "Show installed pi packages and local extensions",
		handler: async (_args, ctx) => {
			const items: string[] = ["--- Packages ---"];
			const pkgs = installedPackages();
			items.push(...(pkgs.length ? pkgs : ["(none)"]));
			items.push("--- Local extensions ---");
			const exts = localExtensions();
			items.push(...(exts.length ? exts : ["(none)"]));

			const selected = await ctx.ui.select("Installed", items);
			if (selected && !selected.startsWith("---") && selected !== "(none)") {
				ctx.ui.notify(selected, "info");
			}
		},
	});
}
