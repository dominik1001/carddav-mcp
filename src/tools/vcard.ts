/**
 * Minimal vCard 3.0 helpers for the contact fields this server exposes.
 *
 * Parsing is line-based and tolerant: it unfolds continuation lines, ignores
 * property groups and parameters, and leaves properties it does not model
 * untouched. Updates are surgical — only the lines for the fields being
 * changed are replaced, so data like PHOTO, ADR or BDAY written by other
 * clients survives a round-trip through update-contact.
 */

export type ContactName = {
	family?: string | undefined;
	given?: string | undefined;
	middle?: string | undefined;
	prefix?: string | undefined;
	suffix?: string | undefined;
};

export type ContactFields = {
	uid?: string;
	fn?: string;
	name?: ContactName;
	emails: string[];
	phones: string[];
	org?: string;
	title?: string;
	note?: string;
};

export type ContactUpdate = {
	fn?: string | undefined;
	name?: ContactName | undefined;
	emails?: string[] | undefined;
	phones?: string[] | undefined;
	org?: string | undefined;
	title?: string | undefined;
	note?: string | undefined;
};

function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\r?\n/g, "\\n")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,");
}

function unescapeText(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch !== "\\") {
			out += ch;
			continue;
		}
		const next = value[i + 1];
		if (next === "n" || next === "N") {
			out += "\n";
			i++;
		} else if (next !== undefined) {
			out += next;
			i++;
		}
	}
	return out;
}

/** Splits a property value on unescaped semicolons (vCard component lists). */
function splitComponents(value: string): string[] {
	const parts: string[] = [];
	let current = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "\\" && i + 1 < value.length) {
			current += ch + value[i + 1];
			i++;
		} else if (ch === ";") {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts;
}

/** Unfolds RFC 6350 line continuations and returns the logical lines. */
function unfoldLines(data: string): string[] {
	const lines: string[] = [];
	for (const raw of data.split(/\r?\n/)) {
		if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
			lines[lines.length - 1] += raw.slice(1);
		} else if (raw.length > 0) {
			lines.push(raw);
		}
	}
	return lines;
}

/** Splits a logical line into its head (name + params) and raw value. */
function splitLine(line: string): { head: string; value: string } | null {
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQuotes = !inQuotes;
		} else if (ch === ":" && !inQuotes) {
			return { head: line.slice(0, i), value: line.slice(i + 1) };
		}
	}
	return null;
}

/** Property name of a logical line, without group prefix or parameters. */
function propertyName(line: string): string | null {
	const split = splitLine(line);
	if (!split) return null;
	const name = split.head.split(";")[0] ?? "";
	const withoutGroup = name.includes(".")
		? (name.split(".").pop() ?? "")
		: name;
	return withoutGroup.toUpperCase();
}

/** Property group of a logical line, e.g. `item3` in `item3.X-ABLABEL:...`. */
function propertyGroup(line: string): string | null {
	const split = splitLine(line);
	if (!split) return null;
	const name = split.head.split(";")[0] ?? "";
	return name.includes(".") ? (name.split(".")[0] ?? "").toLowerCase() : null;
}

/** Apple writes its relation labels as `_$!<Spouse>!$_`. */
const APPLE_LABEL = /^_\$!<(.+)>!\$_$/;

const BINARY_PROPERTIES = new Set(["PHOTO", "LOGO", "SOUND", "KEY"]);

/**
 * Replaces embedded binary payloads with a short marker.
 *
 * An inline PHOTO is base64 and routinely runs to tens of thousands of
 * characters — on a card carrying a portrait it is easily 95% of the vCard.
 * Handing that to a model wastes its context without telling it anything, so
 * the marker keeps the fact that a photo exists and drops the bytes. Folding
 * is not restored, the result is meant to be read rather than stored.
 */
export function stripBinaryValues(data: string): string {
	const lines = unfoldLines(data).map((line) => {
		const split = splitLine(line);
		const name = propertyName(line);
		if (!split || !name || !BINARY_PROPERTIES.has(name)) return line;
		const isBinary =
			/;ENCODING=(B|BASE64)(;|$)/i.test(split.head) ||
			split.value.startsWith("data:");
		return isBinary
			? `${split.head}:<${split.value.length} bytes omitted>`
			: line;
	});
	return `${lines.join("\r\n")}\r\n`;
}

/**
 * Relations recorded on a card, keyed by role: `{ Spouse: "Susann Baer" }`.
 *
 * Clients store these as a pair sharing a property group — `item3.X-ABLABEL`
 * holds the role and `item3.X-ABRELATEDNAMES` the person — which is tedious to
 * reassemble from raw vCard text and easy to get wrong.
 */
export function parseRelations(data: string): Record<string, string[]> {
	const labels = new Map<string, string>();
	const names = new Map<string, string>();
	const relations: Record<string, string[]> = {};

	// A role is not unique on a card: children, siblings and friends routinely
	// appear several times over. Collecting them keeps every name; the same
	// person reached twice, as X-SPOUSE usually is, is recorded once.
	const add = (role: string, person: string) => {
		const people = relations[role];
		if (!people) {
			relations[role] = [person];
		} else if (!people.includes(person)) {
			people.push(person);
		}
	};

	for (const line of unfoldLines(data)) {
		const split = splitLine(line);
		const name = propertyName(line);
		if (!split || !name) continue;
		const value = unescapeText(split.value).trim();
		if (name === "X-SPOUSE" && value) add("Spouse", value);
		const group = propertyGroup(line);
		if (!group || !value) continue;
		if (name === "X-ABLABEL") {
			labels.set(group, APPLE_LABEL.exec(value)?.[1] ?? value);
		} else if (name === "X-ABRELATEDNAMES") {
			names.set(group, value);
		}
	}

	for (const [group, role] of labels) {
		const person = names.get(group);
		if (person) add(role, person);
	}
	return relations;
}

function parseName(value: string): ContactName {
	const [family, given, middle, prefix, suffix] = splitComponents(value).map(
		(c) => unescapeText(c),
	);
	return {
		...(family && { family }),
		...(given && { given }),
		...(middle && { middle }),
		...(prefix && { prefix }),
		...(suffix && { suffix }),
	};
}

export function parseVCard(data: string): ContactFields {
	const fields: ContactFields = { emails: [], phones: [] };
	for (const line of unfoldLines(data)) {
		const split = splitLine(line);
		const name = propertyName(line);
		if (!split || !name) continue;
		switch (name) {
			case "UID":
				fields.uid = unescapeText(split.value);
				break;
			case "FN":
				fields.fn = unescapeText(split.value);
				break;
			case "N":
				fields.name = parseName(split.value);
				break;
			case "EMAIL":
				fields.emails.push(unescapeText(split.value));
				break;
			case "TEL":
				fields.phones.push(unescapeText(split.value));
				break;
			case "ORG":
				fields.org = splitComponents(split.value)
					.map((c) => unescapeText(c))
					.filter((c) => c.length > 0)
					.join(", ");
				break;
			case "TITLE":
				fields.title = unescapeText(split.value);
				break;
			case "NOTE":
				fields.note = unescapeText(split.value);
				break;
		}
	}
	return fields;
}

/** Derives structured name parts from a formatted name (last token = family). */
function deriveName(fn: string): ContactName {
	const tokens = fn.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return {};
	if (tokens.length === 1) {
		const given = tokens[0];
		return given === undefined ? {} : { given };
	}
	const family = tokens[tokens.length - 1];
	return {
		...(family !== undefined && { family }),
		given: tokens.slice(0, -1).join(" "),
	};
}

function nameLine(name: ContactName): string {
	const components = [
		name.family ?? "",
		name.given ?? "",
		name.middle ?? "",
		name.prefix ?? "",
		name.suffix ?? "",
	];
	return `N:${components.map((c) => escapeText(c)).join(";")}`;
}

/**
 * Renders the vCard lines for the given fields. Fields set to an empty
 * string / empty array render no lines (used by updates to clear a field).
 */
function renderFieldLines(fields: ContactUpdate): string[] {
	const lines: string[] = [];
	if (fields.fn !== undefined && fields.fn !== "")
		lines.push(`FN:${escapeText(fields.fn)}`);
	if (fields.name !== undefined) lines.push(nameLine(fields.name));
	for (const email of fields.emails ?? [])
		lines.push(`EMAIL:${escapeText(email)}`);
	for (const phone of fields.phones ?? [])
		lines.push(`TEL:${escapeText(phone)}`);
	if (fields.org !== undefined && fields.org !== "")
		lines.push(`ORG:${escapeText(fields.org)}`);
	if (fields.title !== undefined && fields.title !== "")
		lines.push(`TITLE:${escapeText(fields.title)}`);
	if (fields.note !== undefined && fields.note !== "")
		lines.push(`NOTE:${escapeText(fields.note)}`);
	return lines;
}

export function serializeVCard(
	fields: { uid: string; fn: string } & Omit<ContactUpdate, "fn">,
): string {
	const { uid, fn, name, ...rest } = fields;
	const lines = [
		"BEGIN:VCARD",
		"VERSION:3.0",
		`UID:${escapeText(uid)}`,
		...renderFieldLines({ fn, name: name ?? deriveName(fn), ...rest }),
		"END:VCARD",
	];
	return `${lines.join("\r\n")}\r\n`;
}

const PROPERTY_FOR_FIELD: Record<keyof ContactUpdate, string> = {
	fn: "FN",
	name: "N",
	emails: "EMAIL",
	phones: "TEL",
	org: "ORG",
	title: "TITLE",
	note: "NOTE",
};

/**
 * Applies a partial update to raw vCard data. Only lines for the provided
 * fields are replaced; every other property is preserved verbatim.
 */
export function updateVCardData(data: string, updates: ContactUpdate): string {
	const replaced = new Set(
		(Object.keys(PROPERTY_FOR_FIELD) as Array<keyof ContactUpdate>)
			.filter((field) => updates[field] !== undefined)
			.map((field) => PROPERTY_FOR_FIELD[field]),
	);
	const kept = unfoldLines(data).filter((line) => {
		const name = propertyName(line);
		return name === null || !replaced.has(name);
	});
	const endIndex = kept.findIndex((line) => /^END:VCARD\s*$/i.test(line));
	if (endIndex === -1) {
		throw new Error("Invalid vCard: missing END:VCARD");
	}
	kept.splice(endIndex, 0, ...renderFieldLines(updates));
	return `${kept.join("\r\n")}\r\n`;
}
