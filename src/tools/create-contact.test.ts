import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { registerCreateContact } from "./create-contact.js";

type ToolHandler = (params: {
	addressBookUrl: string;
	fn: string;
	name?: { family?: string; given?: string };
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
			if (name === "create-contact") toolHandler = handler;
			return originalRegisterTool(name, config, handler);
		},
	) as typeof server.registerTool;
	return { server, getHandler: () => toolHandler };
}

describe("registerCreateContact", () => {
	test("creates a vCard named <uid>.vcf and returns the uid", async () => {
		const mockClient = {
			createVCard: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
		};

		const { server, getHandler } = makeServer();
		registerCreateContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		const result = await handler({
			addressBookUrl: "/dav/contacts/",
			fn: "Ada Lovelace",
			emails: ["ada@example.com"],
			phones: ["+44 20 7946 0000"],
			org: "Analytical Engines Ltd",
		});
		const uid = result.content[0]?.text;
		expect(uid).toMatch(/^[0-9a-f-]{36}$/);

		const params = mockClient.createVCard.mock.calls[0]?.[0];
		expect(params.addressBook).toEqual({ url: "/dav/contacts/" });
		expect(params.filename).toBe(`${uid}.vcf`);
		expect(params.vCardString).toContain(`UID:${uid}`);
		expect(params.vCardString).toContain("FN:Ada Lovelace");
		expect(params.vCardString).toContain("N:Lovelace;Ada;;;");
		expect(params.vCardString).toContain("EMAIL:ada@example.com");
		expect(params.vCardString).toContain("TEL:+44 20 7946 0000");
		expect(params.vCardString).toContain("ORG:Analytical Engines Ltd");
	});

	test("prefers an explicit structured name over the derived one", async () => {
		const mockClient = {
			createVCard: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
		};

		const { server, getHandler } = makeServer();
		registerCreateContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await handler({
			addressBookUrl: "/dav/contacts/",
			fn: "Grace Hopper",
			name: { family: "Hopper", given: "Grace" },
		});

		const params = mockClient.createVCard.mock.calls[0]?.[0];
		expect(params.vCardString).toContain("N:Hopper;Grace;;;");
	});

	test("throws a descriptive error when the server rejects the create", async () => {
		const mockClient = {
			createVCard: vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				statusText: "Forbidden",
			}),
		};

		const { server, getHandler } = makeServer();
		registerCreateContact(mockClient as unknown as DAVClient, server);
		const handler = getHandler();
		if (!handler) throw new Error("handler not registered");

		await expect(
			handler({ addressBookUrl: "/dav/contacts/", fn: "Ada" }),
		).rejects.toThrow("Failed to create contact: 403 Forbidden");
	});
});
