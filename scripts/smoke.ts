#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
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

/** Asserts the tool reported an error instead of returning a result. */
function expectToolError(result: unknown, what: string): string {
	const r = result as ToolResult;
	const text = r.content?.[0]?.text ?? "";
	if (!r.isError) {
		throw new Error(`${what}: expected a tool error, got result: ${text}`);
	}
	return text;
}

function withTrailingSlash(url: string): string {
	return url.endsWith("/") ? url : `${url}/`;
}

/** Folds a content line at 75 characters, as RFC 6350 clients write them. */
function fold(line: string): string {
	const parts = [line.slice(0, 75)];
	for (let i = 75; i < line.length; i += 74) {
		parts.push(` ${line.slice(i, i + 74)}`);
	}
	return parts.join("\r\n");
}

/** Logical content lines of a vCard, with folded continuations joined. */
function unfold(vcard: string): string[] {
	return vcard
		.replace(/\r?\n[ \t]/g, "")
		.split(/\r?\n/)
		.filter((line) => line.length > 0);
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

	// An address book that cannot be read must surface as a tool error. An
	// empty list would tell the agent the address book has no contacts.
	const missingBookUrl = new URL(
		`carddav-mcp-smoke-missing-${randomUUID()}/`,
		withTrailingSlash(addressBookUrl),
	).href;
	const missingError = expectToolError(
		await client.callTool({
			name: "list-contacts",
			arguments: { addressBookUrl: missingBookUrl },
		}),
		"list-contacts on a missing address book",
	);
	log("missing address book reported as error", missingError.slice(0, 80));

	// Cards written by other clients need not be stored as `<uid>.vcf`. Put one
	// under an unrelated filename with plain HTTP, as another client would, so
	// get/update/delete can only find it through resolveContact's scan.
	const authorization = `Basic ${Buffer.from(
		`${requireEnv("CARDDAV_USERNAME")}:${requireEnv("CARDDAV_PASSWORD")}`,
	).toString("base64")}`;

	const foreignUid = `carddav-mcp-smoke-${randomUUID()}`;
	const foreignHref = new URL(
		`other-client-${randomUUID()}.vcf`,
		withTrailingSlash(addressBookUrl),
	).href;
	const foreignFn = `Smoke Foreign ${stamp}`;
	const created = await fetch(foreignHref, {
		method: "PUT",
		headers: {
			Authorization: authorization,
			"Content-Type": "text/vcard; charset=utf-8",
			"If-None-Match": "*",
		},
		body: [
			"BEGIN:VCARD",
			"VERSION:3.0",
			`UID:${foreignUid}`,
			`FN:${foreignFn}`,
			"N:Foreign;Smoke;;;",
			"EMAIL:foreign@example.com",
			"END:VCARD",
			"",
		].join("\r\n"),
	});
	if (!created.ok)
		throw new Error(
			`Could not seed foreign card: ${created.status} ${created.statusText}`,
		);
	log("seeded card under a foreign filename", new URL(foreignHref).pathname);

	try {
		const foreign = JSON.parse(
			unwrapText(
				await client.callTool({
					name: "get-contact",
					arguments: { uid: foreignUid, addressBookUrl },
				}),
			),
		) as { fn?: string };
		if (foreign.fn !== foreignFn)
			throw new Error(`Foreign get fn mismatch: ${foreign.fn}`);
		log("got foreign card by uid");

		unwrapText(
			await client.callTool({
				name: "update-contact",
				arguments: {
					uid: foreignUid,
					addressBookUrl,
					note: "updated by smoke test",
				},
			}),
		);
		// The update must be written back to the card's own href, not to a new
		// `<uid>.vcf` beside it.
		const stored = await fetch(foreignHref, {
			headers: { Authorization: authorization },
		});
		if (!stored.ok || !(await stored.text()).includes("updated by smoke test"))
			throw new Error("Update was not written to the foreign card's href");
		log("updated foreign card in place");

		unwrapText(
			await client.callTool({
				name: "delete-contact",
				arguments: { uid: foreignUid, addressBookUrl },
			}),
		);
		const afterForeign = JSON.parse(
			unwrapText(
				await client.callTool({
					name: "list-contacts",
					arguments: { addressBookUrl },
				}),
			),
		) as Array<{ uid?: string }>;
		if (afterForeign.some((c) => c.uid === foreignUid))
			throw new Error(`Foreign card ${foreignUid} still present after delete`);
		log("deleted foreign card");
	} catch (err) {
		// Leave no smoke data behind when a step above failed.
		await fetch(foreignHref, {
			method: "DELETE",
			headers: { Authorization: authorization },
		}).catch(() => {});
		throw err;
	}

	// Cards from real address books carry far more than the fields these tools
	// model: inline photos, Apple's grouped relation labels (free text, so any
	// word, including `constructor`), long folded lines. get-contact must still
	// read such a card, and update-contact must keep every property it does not
	// change.
	const unusualUid = `carddav-mcp-smoke-${randomUUID()}`;
	const unusualHref = new URL(
		`other-client-${randomUUID()}.vcf`,
		withTrailingSlash(addressBookUrl),
	).href;
	const unusualFn = `Smoke Unusual ${stamp}`;
	const photo = Buffer.alloc(30_000, "carddav-mcp smoke photo ").toString(
		"base64",
	);
	const seeded = await fetch(unusualHref, {
		method: "PUT",
		headers: {
			Authorization: authorization,
			"Content-Type": "text/vcard; charset=utf-8",
			"If-None-Match": "*",
		},
		body: [
			"BEGIN:VCARD",
			"VERSION:3.0",
			`UID:${unusualUid}`,
			`FN:${unusualFn}`,
			"N:Unusual;Smoke;;;",
			"EMAIL:unusual@example.com",
			"item1.X-ABLABEL:constructor",
			"item1.X-ABRELATEDNAMES:Grace Hopper",
			"item2.X-ABLABEL:_$!<Spouse>!$_",
			"item2.X-ABRELATEDNAMES:Charles Babbage",
			fold(`PHOTO;ENCODING=b;TYPE=JPEG:${photo}`),
			"END:VCARD",
			"",
		].join("\r\n"),
	});
	if (!seeded.ok)
		throw new Error(
			`Could not seed unusual card: ${seeded.status} ${seeded.statusText}`,
		);
	log("seeded card with a photo and custom relation labels");

	try {
		// Servers may normalise a card on PUT (Radicale reorders properties), so
		// compare against what the server stored, not against what was sent.
		const before = await fetch(unusualHref, {
			headers: { Authorization: authorization },
		});
		if (!before.ok)
			throw new Error(`Could not read unusual card back: ${before.status}`);
		const storedBefore = await before.text();

		const unusual = JSON.parse(
			unwrapText(
				await client.callTool({
					name: "get-contact",
					arguments: { uid: unusualUid, addressBookUrl },
				}),
			),
		) as { fn?: string; emails: string[] };
		if (unusual.fn !== unusualFn)
			throw new Error(`Unusual get fn mismatch: ${unusual.fn}`);
		if (!unusual.emails.includes("unusual@example.com"))
			throw new Error("Email missing from the unusual card");
		log("got unusual card by uid");

		unwrapText(
			await client.callTool({
				name: "update-contact",
				arguments: {
					uid: unusualUid,
					addressBookUrl,
					note: "updated by smoke test",
				},
			}),
		);
		const updated = await fetch(unusualHref, {
			headers: { Authorization: authorization },
		});
		if (!updated.ok)
			throw new Error(`Could not read updated card: ${updated.status}`);
		const storedAfter = new Set(unfold(await updated.text()));
		if (!storedAfter.has("NOTE:updated by smoke test"))
			throw new Error("Update did not write the note");
		// Every property the update did not touch must come back unchanged.
		const lost = unfold(storedBefore).filter(
			(line) => !/^(NOTE|REV|PRODID)[;:]/i.test(line) && !storedAfter.has(line),
		);
		if (lost.length > 0)
			throw new Error(
				`update-contact lost or changed properties: ${lost
					.map((line) => line.slice(0, 60))
					.join(" | ")}`,
			);
		log("update kept the photo and relation labels");
	} finally {
		// Leave no smoke data behind, whether the steps above passed or not.
		await fetch(unusualHref, {
			method: "DELETE",
			headers: { Authorization: authorization },
		}).catch(() => {});
	}
	log("deleted unusual card");

	await client.close();
	console.log("\n✅ smoke test passed");
}

main().catch((err) => {
	console.error("\n❌ smoke test failed:", err);
	process.exit(1);
});
