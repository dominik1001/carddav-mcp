import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerGetContact } from "./get-contact.js";

type ToolHandler = (params: {
	uid: string;
	addressBookUrl: string;
}) => Promise<{ content: { type: string; text: string }[] }>;

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "get-contact") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

const vcard = [
	"BEGIN:VCARD",
	"VERSION:3.0",
	"UID:a",
	"FN:Ada Lovelace",
	"N:Lovelace;Ada;;;",
	"EMAIL:ada@example.com",
	"ORG:Analytical Engines Ltd",
	"TITLE:Mathematician",
	"NOTE:first programmer",
	"END:VCARD",
	"",
].join("\r\n");

describe("registerGetContact", () => {
	test("returns parsed fields plus the raw vCard", async () => {
		const mockClient = {
			fetchVCards: vi
				.fn()
				.mockResolvedValue([{ url: "/dav/contacts/a.vcf", data: vcard }]),
		};

		const { server, getHandler } = makeServer();
		registerGetContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({
			uid: "a",
			addressBookUrl: "/dav/contacts/",
		});
		const text = result.content[0]?.text;
		if (!text) throw new Error("no text content");
		expect(JSON.parse(text)).toEqual({
			uid: "a",
			fn: "Ada Lovelace",
			name: { family: "Lovelace", given: "Ada" },
			emails: ["ada@example.com"],
			phones: [],
			org: "Analytical Engines Ltd",
			title: "Mathematician",
			note: "first programmer",
			vcard,
		});
	});

	test("returns relations and omits the inline photo", async () => {
		const card = [
			"BEGIN:VCARD",
			"VERSION:3.0",
			"UID:a",
			"FN:Ada Lovelace",
			`PHOTO;ENCODING=b;TYPE=jpeg:${"QUJD".repeat(1000)}`,
			"item1.X-ABLABEL:_$!<Spouse>!$_",
			"item1.X-ABRELATEDNAMES:Sam Example",
			"END:VCARD",
			"",
		].join("\r\n");
		const mockClient = {
			fetchVCards: vi
				.fn()
				.mockResolvedValue([{ url: "/dav/contacts/a.vcf", data: card }]),
		};

		const { server, getHandler } = makeServer();
		registerGetContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({
			uid: "a",
			addressBookUrl: "/dav/contacts/",
		});
		const text = result.content[0]?.text;
		if (!text) throw new Error("no text content");
		const data = JSON.parse(text);
		expect(data.relations).toEqual({ Spouse: ["Sam Example"] });
		expect(data.vcard).toContain(
			"PHOTO;ENCODING=b;TYPE=jpeg:<3000 bytes omitted>",
		);
		expect(data.vcard).not.toContain("QUJD");
	});

	test("propagates a not-found error", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		const { server, getHandler } = makeServer();
		registerGetContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ uid: "missing", addressBookUrl: "/dav/contacts/" }),
		).rejects.toThrow("Contact not found: missing");
	});
});
