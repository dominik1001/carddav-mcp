import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerListAddressBooks } from "./list-address-books.js";

type ToolHandler = () => Promise<{
	content: { type: string; text: string }[];
}>;

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "list-address-books") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

describe("registerListAddressBooks", () => {
	test("returns name and URL per address book", async () => {
		const mockClient = {
			fetchAddressBooks: vi.fn().mockResolvedValue([
				{ displayName: "Personal", url: "/dav/contacts/", ctag: "1" },
				{ displayName: {}, url: "/dav/shared/" },
			]),
		};

		const { server, getHandler } = makeServer();
		await registerListAddressBooks(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler();
		const text = result.content[0]?.text;
		if (!text) throw new Error("no text content");
		expect(JSON.parse(text)).toEqual([
			{ displayName: "Personal", url: "/dav/contacts/" },
			{ url: "/dav/shared/" },
		]);
	});
});
