import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerListContacts } from "./list-contacts.js";

type ToolHandler = (params: {
	addressBookUrl: string;
}) => Promise<{ content: { type: string; text: string }[] }>;

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "list-contacts") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

describe("registerListContacts", () => {
	test("returns a summary per contact", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([
				{
					url: "/dav/contacts/a.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.com\r\nTEL:+44 20 7946 0000\r\nEND:VCARD\r\n",
				},
				{
					url: "/dav/contacts/b.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:b\r\nFN:Grace Hopper\r\nEND:VCARD\r\n",
				},
			]),
		};

		const { server, getHandler } = makeServer();
		registerListContacts(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({ addressBookUrl: "/dav/contacts/" });
		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: "/dav/contacts/" },
		});
		const text = result.content[0]?.text;
		if (!text) throw new Error("no text content");
		expect(JSON.parse(text)).toEqual([
			{
				uid: "a",
				fn: "Ada Lovelace",
				emails: ["ada@example.com"],
				phones: ["+44 20 7946 0000"],
			},
			{ uid: "b", fn: "Grace Hopper", emails: [], phones: [] },
		]);
	});

	test("skips entries without vCard data", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([
				{ url: "/dav/contacts/broken.vcf", data: undefined },
				{
					url: "/dav/contacts/a.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Ada\r\nEND:VCARD\r\n",
				},
			]),
		};

		const { server, getHandler } = makeServer();
		registerListContacts(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({ addressBookUrl: "/dav/contacts/" });
		const text = result.content[0]?.text;
		if (!text) throw new Error("no text content");
		expect(JSON.parse(text)).toHaveLength(1);
	});
});
