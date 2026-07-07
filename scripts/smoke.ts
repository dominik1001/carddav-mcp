#!/usr/bin/env tsx
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
};

function unwrapText(result: unknown): string {
	const r = result as ToolResult;
	const first = r.content?.[0];
	if (first?.type !== "text") {
		throw new Error(`Unexpected tool result shape: ${JSON.stringify(result)}`);
	}
	if (r.isError) {
		throw new Error(`Tool returned error: ${first.text}`);
	}
	return first.text;
}

function log(step: string, detail?: unknown) {
	const suffix =
		detail === undefined
			? ""
			: ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
	console.log(`▶ ${step}${suffix}`);
}

async function main() {
	function requireEnv(name: string): string {
		const value = process.env[name];
		if (!value) {
			console.error(`Missing env var: ${name}`);
			process.exit(1);
		}
		return value;
	}

	const transport = new StdioClientTransport({
		command: "node",
		args: ["dist/index.js"],
		env: {
			PATH: process.env.PATH ?? "",
			CARDDAV_BASE_URL: requireEnv("CARDDAV_BASE_URL"),
			CARDDAV_USERNAME: requireEnv("CARDDAV_USERNAME"),
			CARDDAV_PASSWORD: requireEnv("CARDDAV_PASSWORD"),
		},
		stderr: "inherit",
	});

	const client = new Client({ name: "carddav-mcp-smoke", version: "0.0.0" });
	await client.connect(transport);
	log("connected to server");

	const { tools } = await client.listTools();
	const toolNames = tools.map((t) => t.name).sort();
	log("tools registered", toolNames);
	const expected = [
		"list-address-books",
		"list-contacts",
		"get-contact",
		"create-contact",
		"update-contact",
		"delete-contact",
	];
	for (const name of expected) {
		if (!toolNames.includes(name)) throw new Error(`Missing tool: ${name}`);
	}

	const addressBooksRaw = unwrapText(
		await client.callTool({ name: "list-address-books", arguments: {} }),
	);
	const addressBooks = JSON.parse(addressBooksRaw) as Array<{
		displayName?: string;
		url: string;
	}>;
	if (addressBooks.length === 0) throw new Error("No address books returned");
	const addressBookUrl = addressBooks[0].url;
	log("using address book", addressBooks[0].displayName ?? addressBookUrl);

	const stamp = new Date().toISOString();
	const fn = `Smoke Test ${stamp}`;
	const email = "smoke@example.com";
	const phone = "+1 555 0100";

	const uid = unwrapText(
		await client.callTool({
			name: "create-contact",
			arguments: {
				addressBookUrl,
				fn,
				emails: [email],
				phones: [phone],
				org: "carddav-mcp smoke",
			},
		}),
	);
	log("created contact", uid);

	const listed = JSON.parse(
		unwrapText(
			await client.callTool({
				name: "list-contacts",
				arguments: { addressBookUrl },
			}),
		),
	) as Array<{ uid?: string; fn?: string; emails: string[] }>;
	const found = listed.find((c) => c.uid === uid);
	if (!found)
		throw new Error(`Created contact ${uid} not found in list-contacts`);
	if (found.fn !== fn)
		throw new Error(`Formatted name mismatch: ${found.fn} !== ${fn}`);
	if (!found.emails.includes(email))
		throw new Error(`Email ${email} missing from listed contact`);
	log("listed contact", { uid: found.uid, fn: found.fn });

	const fetched = JSON.parse(
		unwrapText(
			await client.callTool({
				name: "get-contact",
				arguments: { uid, addressBookUrl },
			}),
		),
	) as {
		uid: string;
		fn?: string;
		emails: string[];
		phones: string[];
		org?: string;
		vcard: string;
	};
	if (fetched.fn !== fn)
		throw new Error(`get-contact fn mismatch: ${fetched.fn} !== ${fn}`);
	if (!fetched.phones.includes(phone))
		throw new Error(`Phone ${phone} missing from get-contact`);
	if (fetched.org !== "carddav-mcp smoke")
		throw new Error(`Org mismatch: ${fetched.org}`);
	if (!fetched.vcard.includes("BEGIN:VCARD"))
		throw new Error("get-contact did not return the raw vCard");
	log("fetched contact", { uid: fetched.uid, org: fetched.org });

	const updatedFn = `${fn} (updated)`;
	const updatedUid = unwrapText(
		await client.callTool({
			name: "update-contact",
			arguments: {
				uid,
				addressBookUrl,
				fn: updatedFn,
				note: "updated by smoke test",
			},
		}),
	);
	log("updated contact", updatedUid);

	const afterUpdate = JSON.parse(
		unwrapText(
			await client.callTool({
				name: "get-contact",
				arguments: { uid: updatedUid, addressBookUrl },
			}),
		),
	) as { fn?: string; note?: string; emails: string[] };
	if (afterUpdate.fn !== updatedFn)
		throw new Error(`Updated fn mismatch: ${afterUpdate.fn} !== ${updatedFn}`);
	if (afterUpdate.note !== "updated by smoke test")
		throw new Error(`Updated note mismatch: ${afterUpdate.note}`);
	if (!afterUpdate.emails.includes(email))
		throw new Error("Email was lost by a partial update");
	log("verified update", { fn: afterUpdate.fn, note: afterUpdate.note });

	const deleted = unwrapText(
		await client.callTool({
			name: "delete-contact",
			arguments: { uid: updatedUid, addressBookUrl },
		}),
	);
	log("deleted contact", deleted);

	const after = JSON.parse(
		unwrapText(
			await client.callTool({
				name: "list-contacts",
				arguments: { addressBookUrl },
			}),
		),
	) as Array<{ uid?: string }>;
	if (after.some((c) => c.uid === updatedUid))
		throw new Error(`Contact ${updatedUid} still present after delete`);
	log("verified deletion");

	await client.close();
	console.log("\n✅ smoke test passed");
}

main().catch((err) => {
	console.error("\n❌ smoke test failed:", err);
	process.exit(1);
});
