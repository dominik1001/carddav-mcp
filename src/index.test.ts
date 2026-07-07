import { beforeAll, describe, expect, test, vi } from "vitest";

// Mock all dependencies before any imports
vi.mock("tsdav");
vi.mock("@modelcontextprotocol/sdk/server/mcp.js");
vi.mock("@modelcontextprotocol/sdk/server/stdio.js");
vi.mock("./tools/create-contact.js");
vi.mock("./tools/delete-contact.js");
vi.mock("./tools/get-contact.js");
vi.mock("./tools/list-address-books.js");
vi.mock("./tools/list-contacts.js");
vi.mock("./tools/update-contact.js");

describe("MCP Server Console Output", () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeAll(async () => {
		// Setup environment variables
		process.env.CARDDAV_BASE_URL = "https://example.com/carddav";
		process.env.CARDDAV_USERNAME = "testuser";
		process.env.CARDDAV_PASSWORD = "testpassword";

		// Create spies before importing the module
		consoleLogSpy = vi
			.spyOn(console, "log")
			.mockImplementation(() => undefined);
		consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		vi.spyOn(process, "exit").mockImplementation(() => {
			return undefined as never;
		});

		// Mock successful CardDAV client
		const { DAVClient } = await import("tsdav");
		class MockDAVClient {
			login = vi.fn().mockResolvedValue(undefined);
			fetchAddressBooks = vi.fn().mockResolvedValue([
				{
					displayName: "Test Contacts",
					url: "https://example.com/carddav/contacts/",
				},
			]);
		}
		vi.mocked(DAVClient).mockImplementation(
			MockDAVClient as unknown as typeof DAVClient,
		);

		// Mock MCP Server
		const { McpServer } = await import(
			"@modelcontextprotocol/sdk/server/mcp.js"
		);
		class MockMcpServer {
			registerTool = vi.fn();
			connect = vi.fn().mockResolvedValue(undefined);
		}
		vi.mocked(McpServer).mockImplementation(
			MockMcpServer as unknown as typeof McpServer,
		);

		// Mock StdioServerTransport
		const { StdioServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/stdio.js"
		);
		class MockStdioServerTransport {}
		vi.mocked(StdioServerTransport).mockImplementation(
			MockStdioServerTransport as unknown as typeof StdioServerTransport,
		);

		// Mock tool registration functions
		const createContact = await import("./tools/create-contact.js");
		const deleteContact = await import("./tools/delete-contact.js");
		const getContact = await import("./tools/get-contact.js");
		const listAddressBooks = await import("./tools/list-address-books.js");
		const listContacts = await import("./tools/list-contacts.js");
		const updateContact = await import("./tools/update-contact.js");

		vi.mocked(createContact.registerCreateContact).mockImplementation(
			() => undefined,
		);
		vi.mocked(deleteContact.registerDeleteContact).mockImplementation(
			() => undefined,
		);
		vi.mocked(getContact.registerGetContact).mockImplementation(
			() => undefined,
		);
		vi.mocked(listAddressBooks.registerListAddressBooks).mockResolvedValue(
			undefined,
		);
		vi.mocked(listContacts.registerListContacts).mockImplementation(
			() => undefined,
		);
		vi.mocked(updateContact.registerUpdateContact).mockImplementation(
			() => undefined,
		);

		// Now import the main module which will execute
		await import("./index.js");

		// Wait a bit for async operations
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	test("should not write to console in success case", () => {
		// The main assertion: in a success case, there should be no console output
		// This test will FAIL if console.log or console.error is called
		expect(consoleLogSpy).not.toHaveBeenCalled();
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	test("MCP server was initialized successfully", () => {
		// This test passes if the server started without errors
		// The fact that we reached this point means the server initialized
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});
});
