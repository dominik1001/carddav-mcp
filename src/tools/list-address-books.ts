import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";

export const listAddressBooksDefinition = {
	name: "list-address-books",
	description: "List all address books returning both name and URL",
	inputSchema: {},
	returns: "List of all available address books",
} as const;

export async function registerListAddressBooks(
	client: DAVClient,
	server: McpServer,
) {
	const addressBooks = await client.fetchAddressBooks();
	const data = addressBooks.map((book) => ({
		...(typeof book.displayName === "string" &&
			book.displayName !== "" && { displayName: book.displayName }),
		url: book.url,
	}));

	server.registerTool(
		listAddressBooksDefinition.name,
		{
			description: listAddressBooksDefinition.description,
			inputSchema: listAddressBooksDefinition.inputSchema,
		},
		async () => {
			return { content: [{ type: "text", text: JSON.stringify(data) }] };
		},
	);
}
