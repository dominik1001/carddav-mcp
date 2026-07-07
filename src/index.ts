#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DAVClient } from "tsdav";

import { registerCreateContact } from "./tools/create-contact.js";
import { registerDeleteContact } from "./tools/delete-contact.js";
import { registerGetContact } from "./tools/get-contact.js";
import { registerListAddressBooks } from "./tools/list-address-books.js";
import { registerListContacts } from "./tools/list-contacts.js";
import { registerUpdateContact } from "./tools/update-contact.js";

const server = new McpServer({
	name: "carddav-mcp",
	version: "0.1.0",
});

async function main() {
	const client = new DAVClient({
		serverUrl: process.env.CARDDAV_BASE_URL || "",
		credentials: {
			username: process.env.CARDDAV_USERNAME || "",
			password: process.env.CARDDAV_PASSWORD || "",
		},
		authMethod: "Basic",
		defaultAccountType: "carddav",
	});

	// Test connection on startup
	try {
		await client.login();
	} catch (error) {
		console.error("❌ Failed to connect to CardDAV server:", error);
		process.exit(1);
	}

	registerCreateContact(client, server);
	registerListContacts(client, server);
	registerGetContact(client, server);
	registerUpdateContact(client, server);
	registerDeleteContact(client, server);
	await registerListAddressBooks(client, server);

	// Start receiving messages on stdin and sending messages on stdout
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main();
