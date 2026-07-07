import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { z } from "zod";
import { resolveContact } from "./resolve-contact.js";

type DeleteContactInput = {
	uid: string;
	addressBookUrl: string;
};

export const deleteContactDefinition = {
	name: "delete-contact",
	description: "Deletes a contact in the address book specified by its URL",
	inputSchema: {
		uid: z
			.string()
			.describe(
				"Unique identifier of the contact to delete (obtained from list-contacts)",
			),
		addressBookUrl: z.string(),
	},
	returns: "Confirmation message when the contact is successfully deleted",
} as const;

export function registerDeleteContact(client: DAVClient, server: McpServer) {
	server.registerTool(
		deleteContactDefinition.name,
		{
			description: deleteContactDefinition.description,
			inputSchema: deleteContactDefinition.inputSchema,
		},
		async (args: DeleteContactInput) => {
			const { uid, addressBookUrl } = args;
			const card = await resolveContact(client, addressBookUrl, uid);
			const response = await client.deleteVCard({ vCard: card });
			if (!response.ok) {
				throw new Error(
					`Failed to delete contact: ${response.status} ${response.statusText}`,
				);
			}

			return {
				content: [{ type: "text", text: "Contact deleted" }],
			};
		},
	);
}
