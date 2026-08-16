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

function run(client: unknown, addressBookUrl = "/dav/contacts/") {
	const { server, getHandler } = makeServer();
	registerListContacts(client as DAVClient, server);
	const handler = getHandler();
	if (!handler) throw new Error("handler not registered");
	return handler({ addressBookUrl });
}

function parse(result: { content: { text: string }[] }) {
	const text = result.content[0]?.text;
	if (!text) throw new Error("no text content");
	return JSON.parse(text);
}

describe("registerListContacts", () => {
	test("returns a summary per contact", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValue([
					{ href: "/dav/contacts/" },
					{ href: "/dav/contacts/a.vcf" },
					{ href: "/dav/contacts/b.vcf" },
				]),
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

		const result = await run(mockClient);

		expect(mockClient.propfind).toHaveBeenCalledWith({
			url: "/dav/contacts/",
			props: { "d:getetag": {} },
			depth: "1",
		});
		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: "/dav/contacts/" },
			objectUrls: ["/dav/contacts/a.vcf", "/dav/contacts/b.vcf"],
		});
		expect(parse(result)).toEqual([
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
			propfind: vi
				.fn()
				.mockResolvedValue([
					{ href: "/dav/contacts/broken.vcf" },
					{ href: "/dav/contacts/a.vcf" },
				]),
			fetchVCards: vi.fn().mockResolvedValue([
				{ url: "/dav/contacts/broken.vcf", data: undefined },
				{
					url: "/dav/contacts/a.vcf",
					data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Ada\r\nEND:VCARD\r\n",
				},
			]),
		};

		expect(parse(await run(mockClient))).toHaveLength(1);
	});

	test("resolves absolute hrefs against an absolute collection url", async () => {
		const mockClient = {
			propfind: vi
				.fn()
				.mockResolvedValue([
					{ href: "https://dav.example.org/carddav/32/" },
					{ href: "https://dav.example.org/carddav/32/a.vcf" },
				]),
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		await run(mockClient, "https://dav.example.org/carddav/32/");

		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: "https://dav.example.org/carddav/32/" },
			objectUrls: ["/carddav/32/a.vcf"],
		});
	});

	test("does not call fetchVCards for an empty address book", async () => {
		const mockClient = {
			propfind: vi.fn().mockResolvedValue([{ href: "/dav/contacts/" }]),
			fetchVCards: vi.fn(),
		};

		expect(parse(await run(mockClient))).toEqual([]);
		expect(mockClient.fetchVCards).not.toHaveBeenCalled();
	});
});
