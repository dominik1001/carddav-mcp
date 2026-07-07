import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerDeleteContact } from "./delete-contact.js";

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
			if (name === "delete-contact") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

const card = {
	url: "/dav/contacts/a.vcf",
	etag: '"etag-1"',
	data: "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:a\r\nFN:Ada\r\nEND:VCARD\r\n",
};

describe("registerDeleteContact", () => {
	test("resolves the contact and deletes it", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([card]),
			deleteVCard: vi.fn().mockResolvedValue({ ok: true, status: 204 }),
		};

		const { server, getHandler } = makeServer();
		registerDeleteContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({
			uid: "a",
			addressBookUrl: "/dav/contacts/",
		});
		expect(result.content[0]?.text).toBe("Contact deleted");
		expect(mockClient.deleteVCard).toHaveBeenCalledWith({ vCard: card });
	});

	test("throws when the contact does not exist", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([]),
			deleteVCard: vi.fn(),
		};

		const { server, getHandler } = makeServer();
		registerDeleteContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ uid: "missing", addressBookUrl: "/dav/contacts/" }),
		).rejects.toThrow("Contact not found: missing");
		expect(mockClient.deleteVCard).not.toHaveBeenCalled();
	});

	test("throws a descriptive error when the server rejects the delete", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([card]),
			deleteVCard: vi.fn().mockResolvedValue({
				ok: false,
				status: 423,
				statusText: "Locked",
			}),
		};

		const { server, getHandler } = makeServer();
		registerDeleteContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ uid: "a", addressBookUrl: "/dav/contacts/" }),
		).rejects.toThrow("Failed to delete contact: 423 Locked");
	});
});
