import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerUpdateContact } from "./update-contact.js";

type ToolHandler = (params: {
	uid: string;
	addressBookUrl: string;
	fn?: string;
	emails?: string[];
	phones?: string[];
	org?: string;
	title?: string;
	note?: string;
}) => Promise<{ content: { type: string; text: string }[] }>;

function makeServer() {
	let toolHandler: ToolHandler | null = null;
	const server = new McpServer({ name: "test-server", version: "0.1.0" });
	const originalRegisterTool = server.registerTool.bind(server);
	server.registerTool = vi.fn(
		(name: string, config: unknown, handler: ToolHandler) => {
			if (name === "update-contact") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

const existing = {
	url: "/dav/contacts/a.vcf",
	etag: '"etag-1"',
	data: [
		"BEGIN:VCARD",
		"VERSION:3.0",
		"UID:a",
		"FN:Ada Lovelace",
		"EMAIL:old@example.com",
		"BDAY:1815-12-10",
		"END:VCARD",
		"",
	].join("\r\n"),
};

describe("registerUpdateContact", () => {
	test("replaces provided fields, preserves the rest, and keeps url/etag", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([existing]),
			updateVCard: vi.fn().mockResolvedValue({ ok: true, status: 204 }),
		};

		const { server, getHandler } = makeServer();
		registerUpdateContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({
			uid: "a",
			addressBookUrl: "/dav/contacts/",
			fn: "Ada King",
			emails: ["new@example.com"],
		});
		expect(result.content[0]?.text).toBe("a");

		const params = mockClient.updateVCard.mock.calls[0]?.[0];
		expect(params.vCard.url).toBe("/dav/contacts/a.vcf");
		expect(params.vCard.etag).toBe('"etag-1"');
		expect(params.vCard.data).toContain("FN:Ada King");
		expect(params.vCard.data).not.toContain("FN:Ada Lovelace");
		expect(params.vCard.data).toContain("EMAIL:new@example.com");
		expect(params.vCard.data).not.toContain("EMAIL:old@example.com");
		expect(params.vCard.data).toContain("BDAY:1815-12-10");
		expect(params.vCard.data).toContain("UID:a");
	});

	test("throws when the contact does not exist", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([]),
			updateVCard: vi.fn(),
		};

		const { server, getHandler } = makeServer();
		registerUpdateContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ uid: "missing", addressBookUrl: "/dav/contacts/", fn: "x" }),
		).rejects.toThrow("Contact not found: missing");
		expect(mockClient.updateVCard).not.toHaveBeenCalled();
	});

	test("throws a descriptive error when the server rejects the update", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([existing]),
			updateVCard: vi.fn().mockResolvedValue({
				ok: false,
				status: 412,
				statusText: "Precondition Failed",
			}),
		};

		const { server, getHandler } = makeServer();
		registerUpdateContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ uid: "a", addressBookUrl: "/dav/contacts/", note: "x" }),
		).rejects.toThrow("Failed to update contact: 412 Precondition Failed");
	});
});
