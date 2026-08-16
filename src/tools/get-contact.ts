import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { z } from "zod";
import { resolveContact } from "./resolve-contact.js";
import { parseRelations, parseVCard, stripBinaryValues } from "./vcard.js";

type GetContactInput = {
	uid: string;
	addressBookUrl: string;
};

export const getContactDefinition = {
	name: "get-contact",
	description:
		"Get the full details of a single contact in the address book specified by its URL",
	inputSchema: {
		uid: z
			.string()
			.describe(
				"Unique identifier of the contact to fetch (obtained from list-contacts)",
			),
		addressBookUrl: z.string(),
	},
	returns:
		'The contact\'s parsed fields (`uid`, `fn`, `name`, `emails`, `phones`, and optionally `org`, `title`, `note`), any recorded relations keyed by role in `relations` (e.g. `{"Spouse": "Ada Lovelace"}`), plus the vCard in `vcard` with embedded binary values such as PHOTO replaced by a size marker',
} as const;

export function registerGetContact(client: DAVClient, server: McpServer) {
	server.registerTool(
		getContactDefinition.name,
		{
			description: getContactDefinition.description,
			inputSchema: getContactDefinition.inputSchema,
		},
		async (args: GetContactInput) => {
			const { uid, addressBookUrl } = args;
			const card = await resolveContact(client, addressBookUrl, uid);
			const raw = card.data as string;
			const parsed = parseVCard(raw);
			const relations = parseRelations(raw);
			const data = {
				uid,
				...(parsed.fn !== undefined && { fn: parsed.fn }),
				...(parsed.name !== undefined && { name: parsed.name }),
				emails: parsed.emails,
				phones: parsed.phones,
				...(parsed.org !== undefined && { org: parsed.org }),
				...(parsed.title !== undefined && { title: parsed.title }),
				...(parsed.note !== undefined && { note: parsed.note }),
				...(Object.keys(relations).length > 0 && { relations }),
				vcard: stripBinaryValues(raw),
			};
			return {
				content: [{ type: "text", text: JSON.stringify(data) }],
			};
		},
	);
}
