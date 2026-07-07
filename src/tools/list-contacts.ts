import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { z } from "zod";
import { parseVCard } from "./vcard.js";

type ListContactsInput = {
	addressBookUrl: string;
};

export const listContactsDefinition = {
	name: "list-contacts",
	description:
		"List all contacts in the address book specified by its URL. Returns a summary per contact; use get-contact for full details.",
	inputSchema: {
		addressBookUrl: z.string(),
	},
	returns:
		"A list of contacts, each containing `uid`, `fn` (formatted name), `emails`, and `phones`",
} as const;

export function registerListContacts(client: DAVClient, server: McpServer) {
	server.registerTool(
		listContactsDefinition.name,
		{
			description: listContactsDefinition.description,
			inputSchema: listContactsDefinition.inputSchema,
		},
		async (args: ListContactsInput) => {
			const { addressBookUrl } = args;
			const cards = await client.fetchVCards({
				addressBook: { url: addressBookUrl },
			});
			const data = cards
				.filter((card) => typeof card.data === "string")
				.map((card) => {
					const parsed = parseVCard(card.data as string);
					return {
						...(parsed.uid !== undefined && { uid: parsed.uid }),
						...(parsed.fn !== undefined && { fn: parsed.fn }),
						emails: parsed.emails,
						phones: parsed.phones,
					};
				});
			return {
				content: [{ type: "text", text: JSON.stringify(data) }],
			};
		},
	);
}
