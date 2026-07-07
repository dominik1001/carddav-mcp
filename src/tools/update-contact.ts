import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { z } from "zod";
import { resolveContact } from "./resolve-contact.js";
import type { ContactName } from "./vcard.js";
import { updateVCardData } from "./vcard.js";

type UpdateContactInput = {
	uid: string;
	addressBookUrl: string;
	fn?: string | undefined;
	name?: ContactName | undefined;
	emails?: string[] | undefined;
	phones?: string[] | undefined;
	org?: string | undefined;
	title?: string | undefined;
	note?: string | undefined;
};

const nameSchema = z.object({
	family: z.string().optional(),
	given: z.string().optional(),
	middle: z.string().optional(),
	prefix: z.string().optional(),
	suffix: z.string().optional(),
});

export const updateContactDefinition = {
	name: "update-contact",
	description:
		"Updates an existing contact in the address book specified by its URL. Only provided fields are changed; `emails` and `phones` replace the full list (pass an empty array to clear them, or an empty string to clear `org`, `title`, or `note`). Other vCard properties are preserved.",
	inputSchema: {
		uid: z
			.string()
			.describe(
				"Unique identifier of the contact to update (obtained from list-contacts)",
			),
		addressBookUrl: z.string(),
		fn: z.string().min(1).optional(),
		name: nameSchema.optional(),
		emails: z.array(z.string()).optional(),
		phones: z.array(z.string()).optional(),
		org: z.string().optional(),
		title: z.string().optional(),
		note: z.string().optional(),
	},
	returns: "The unique ID of the updated contact",
} as const;

export function registerUpdateContact(client: DAVClient, server: McpServer) {
	server.registerTool(
		updateContactDefinition.name,
		{
			description: updateContactDefinition.description,
			inputSchema: updateContactDefinition.inputSchema,
		},
		async (args: UpdateContactInput) => {
			const {
				uid,
				addressBookUrl,
				fn,
				name,
				emails,
				phones,
				org,
				title,
				note,
			} = args;

			const existing = await resolveContact(client, addressBookUrl, uid);
			const data = updateVCardData(existing.data as string, {
				...(fn !== undefined && { fn }),
				...(name !== undefined && { name }),
				...(emails !== undefined && { emails }),
				...(phones !== undefined && { phones }),
				...(org !== undefined && { org }),
				...(title !== undefined && { title }),
				...(note !== undefined && { note }),
			});

			const response = await client.updateVCard({
				vCard: { ...existing, data },
			});
			if (!response.ok) {
				throw new Error(
					`Failed to update contact: ${response.status} ${response.statusText}`,
				);
			}

			return {
				content: [{ type: "text", text: uid }],
			};
		},
	);
}
