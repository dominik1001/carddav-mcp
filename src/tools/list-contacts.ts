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

/** Lets us normalise relative collection URLs without a real origin. */
const RELATIVE_BASE = "http://carddav.invalid";

/**
 * Lists the href of every card in the address book via PROPFIND.
 *
 * `fetchVCards` discovers hrefs with an addressbook-query REPORT whose default
 * filter is a condition-less `<prop-filter name="FN"/>`. RFC 6352 says that
 * matches every card carrying an FN property, but some servers — Open-Xchange,
 * and therefore mailbox.org — return an empty result instead. The collection
 * then looks empty and no card is ever fetched. PROPFIND is mandatory for a
 * CardDAV collection, so discovering hrefs that way works everywhere.
 */
async function listCardUrls(
	client: DAVClient,
	addressBookUrl: string,
): Promise<string[]> {
	const collection = new URL(addressBookUrl, RELATIVE_BASE);
	const responses = await client.propfind({
		url: addressBookUrl,
		props: { "d:getetag": {} },
		depth: "1",
	});
	return responses
		.map((response) => response.href)
		.filter((href): href is string => Boolean(href))
		.map((href) => new URL(href, collection).pathname)
		.filter((path) => path !== collection.pathname);
}

export function registerListContacts(client: DAVClient, server: McpServer) {
	server.registerTool(
		listContactsDefinition.name,
		{
			description: listContactsDefinition.description,
			inputSchema: listContactsDefinition.inputSchema,
		},
		async (args: ListContactsInput) => {
			const { addressBookUrl } = args;
			const objectUrls = await listCardUrls(client, addressBookUrl);
			const cards =
				objectUrls.length === 0
					? []
					: await client.fetchVCards({
							addressBook: { url: addressBookUrl },
							objectUrls,
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
