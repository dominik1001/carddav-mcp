import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DAVClient } from "tsdav";
import { z } from "zod";
import type { ContactName } from "./vcard.js";
import { serializeVCard } from "./vcard.js";

type CreateContactInput = {
	addressBookUrl: string;
	fn: string;
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

export const createContactDefinition = {
	name: "create-contact",
	description:
		"Creates a contact (vCard) in the address book specified by its URL. If `name` is omitted, structured name parts are derived from `fn`.",
	inputSchema: {
		addressBookUrl: z.string(),
		fn: z.string().min(1).describe("Formatted display name of the contact"),
		name: nameSchema
			.optional()
			.describe("Structured name parts (family, given, middle, ...)"),
		emails: z.array(z.string()).optional(),
		phones: z.array(z.string()).optional(),
		org: z.string().optional().describe("Organization / company"),
		title: z.string().optional().describe("Job title or role"),
		note: z.string().optional(),
	},
	returns: "The unique ID of the created contact",
} as const;

export function registerCreateContact(client: DAVClient, server: McpServer) {
	server.registerTool(
		createContactDefinition.name,
		{
			description: createContactDefinition.description,
			inputSchema: createContactDefinition.inputSchema,
		},
		async (args: CreateContactInput) => {
			const { addressBookUrl, fn, name, emails, phones, org, title, note } =
				args;
			const uid = randomUUID();
			const vCardString = serializeVCard({
				uid,
				fn,
				...(name !== undefined && { name }),
				...(emails !== undefined && { emails }),
				...(phones !== undefined && { phones }),
				...(org !== undefined && { org }),
				...(title !== undefined && { title }),
				...(note !== undefined && { note }),
			});

			const response = await client.createVCard({
				addressBook: { url: addressBookUrl },
				filename: `${uid}.vcf`,
				vCardString,
			});
			if (!response.ok) {
				throw new Error(
					`Failed to create contact: ${response.status} ${response.statusText}`,
				);
			}

			return {
				content: [{ type: "text", text: uid }],
			};
		},
	);
}
