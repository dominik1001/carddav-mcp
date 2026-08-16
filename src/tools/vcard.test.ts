import { describe, expect, test } from "vitest";
import {
	parseRelations,
	parseVCard,
	serializeVCard,
	stripBinaryValues,
	updateVCardData,
} from "./vcard.js";

describe("serializeVCard", () => {
	test("produces a CRLF-terminated vCard 3.0 with UID, FN and derived N", () => {
		const card = serializeVCard({ uid: "abc-123", fn: "Ada Lovelace" });
		const lines = card.split("\r\n");
		expect(lines[0]).toBe("BEGIN:VCARD");
		expect(lines[1]).toBe("VERSION:3.0");
		expect(lines).toContain("UID:abc-123");
		expect(lines).toContain("FN:Ada Lovelace");
		expect(lines).toContain("N:Lovelace;Ada;;;");
		expect(card.endsWith("END:VCARD\r\n")).toBe(true);
	});

	test("uses explicit structured name over the derived one", () => {
		const card = serializeVCard({
			uid: "u1",
			fn: "Dr. Grace Hopper",
			name: { family: "Hopper", given: "Grace", prefix: "Dr." },
		});
		expect(card).toContain("N:Hopper;Grace;;Dr.;");
	});

	test("writes one line per email and phone", () => {
		const card = serializeVCard({
			uid: "u1",
			fn: "Ada",
			emails: ["ada@example.com", "ada@work.example"],
			phones: ["+44 20 7946 0000"],
		});
		expect(card).toContain("EMAIL:ada@example.com\r\n");
		expect(card).toContain("EMAIL:ada@work.example\r\n");
		expect(card).toContain("TEL:+44 20 7946 0000\r\n");
	});

	test("escapes special characters in text values", () => {
		const card = serializeVCard({
			uid: "u1",
			fn: "Ada; Countess, of\nLovelace",
			note: "back\\slash",
		});
		expect(card).toContain("FN:Ada\\; Countess\\, of\\nLovelace");
		expect(card).toContain("NOTE:back\\\\slash");
	});
});

describe("parseVCard", () => {
	test("round-trips everything serializeVCard writes", () => {
		const fields = {
			uid: "round-trip-1",
			fn: "Ada; Countess, of\nLovelace",
			name: { family: "Lovelace", given: "Ada" },
			emails: ["ada@example.com"],
			phones: ["+44 20 7946 0000"],
			org: "Analytical Engines Ltd",
			title: "Mathematician",
			note: "first programmer",
		};
		const parsed = parseVCard(serializeVCard(fields));
		expect(parsed).toEqual(fields);
	});

	test("unfolds continuation lines and tolerates bare LF endings", () => {
		const data = [
			"BEGIN:VCARD",
			"VERSION:3.0",
			"UID:u1",
			"FN:Ada Love",
			" lace",
			"END:VCARD",
		].join("\n");
		expect(parseVCard(data).fn).toBe("Ada Lovelace");
	});

	test("ignores property groups and parameters", () => {
		const data = [
			"BEGIN:VCARD",
			"VERSION:3.0",
			"UID:u1",
			"FN:Ada",
			'item1.EMAIL;TYPE=WORK;X-LABEL="a:b":ada@work.example',
			"TEL;TYPE=CELL:+1 555 0100",
			"END:VCARD",
		].join("\r\n");
		const parsed = parseVCard(data);
		expect(parsed.emails).toEqual(["ada@work.example"]);
		expect(parsed.phones).toEqual(["+1 555 0100"]);
	});

	test("joins multi-unit ORG values", () => {
		const data = [
			"BEGIN:VCARD",
			"VERSION:3.0",
			"UID:u1",
			"FN:Ada",
			"ORG:Analytical Engines Ltd;Research",
			"END:VCARD",
		].join("\r\n");
		expect(parseVCard(data).org).toBe("Analytical Engines Ltd, Research");
	});
});

describe("updateVCardData", () => {
	const existing = [
		"BEGIN:VCARD",
		"VERSION:3.0",
		"UID:u1",
		"FN:Ada Lovelace",
		"N:Lovelace;Ada;;;",
		"EMAIL:old@example.com",
		"EMAIL:older@example.com",
		"TEL:+1 555 0100",
		"BDAY:1815-12-10",
		"item1.X-ABLabel:_$!<HomePage>!$_",
		"END:VCARD",
		"",
	].join("\r\n");

	test("replaces only the updated fields", () => {
		const updated = updateVCardData(existing, { fn: "Ada King" });
		expect(updated).toContain("FN:Ada King");
		expect(updated).not.toContain("FN:Ada Lovelace");
		expect(updated).toContain("EMAIL:old@example.com");
		expect(updated).toContain("N:Lovelace;Ada;;;");
	});

	test("preserves properties it does not model", () => {
		const updated = updateVCardData(existing, {
			fn: "Ada King",
			emails: ["new@example.com"],
		});
		expect(updated).toContain("BDAY:1815-12-10");
		expect(updated).toContain("item1.X-ABLabel:_$!<HomePage>!$_");
		expect(updated).toContain("UID:u1");
	});

	test("replaces the full email list", () => {
		const updated = updateVCardData(existing, { emails: ["new@example.com"] });
		expect(updated).toContain("EMAIL:new@example.com");
		expect(updated).not.toContain("EMAIL:old@example.com");
		expect(updated).not.toContain("EMAIL:older@example.com");
	});

	test("clears list fields with an empty array and text fields with an empty string", () => {
		const withOrg = updateVCardData(existing, { org: "Acme" });
		expect(withOrg).toContain("ORG:Acme");
		const cleared = updateVCardData(withOrg, { org: "", phones: [] });
		expect(cleared).not.toContain("ORG:");
		expect(cleared).not.toContain("TEL:");
	});

	test("keeps END:VCARD last", () => {
		const updated = updateVCardData(existing, { note: "hi" });
		expect(updated.trimEnd().endsWith("END:VCARD")).toBe(true);
		expect(updated).toContain("NOTE:hi\r\nEND:VCARD");
	});

	test("throws on data without END:VCARD", () => {
		expect(() => updateVCardData("BEGIN:VCARD\r\nUID:u1", { fn: "x" })).toThrow(
			/END:VCARD/,
		);
	});
});

describe("stripBinaryValues", () => {
	test("replaces an inline photo with a size marker", () => {
		const card = [
			"BEGIN:VCARD",
			"VERSION:3.0",
			"FN:Ada Lovelace",
			`PHOTO;ENCODING=b;TYPE=jpeg:${"A".repeat(5000)}`,
			"END:VCARD",
		].join("\r\n");
		const stripped = stripBinaryValues(card);
		expect(stripped).toContain(
			"PHOTO;ENCODING=b;TYPE=jpeg:<5000 bytes omitted>",
		);
		expect(stripped).toContain("FN:Ada Lovelace");
		expect(stripped.length).toBeLessThan(300);
	});

	test("leaves a photo reference by URL alone", () => {
		const card = [
			"BEGIN:VCARD",
			"PHOTO;VALUE=uri:https://example.com/ada.jpg",
			"END:VCARD",
		].join("\r\n");
		expect(stripBinaryValues(card)).toContain(
			"PHOTO;VALUE=uri:https://example.com/ada.jpg",
		);
	});
});

describe("parseRelations", () => {
	test("pairs a label with the related name by property group", () => {
		const card = [
			"BEGIN:VCARD",
			"FN:Jan Baer",
			"X-SPOUSE:Susann Baer",
			"item1.X-ABLABEL:homePage",
			"item2.X-ABLABEL:_$!<Mother>!$_",
			"item2.X-ABRELATEDNAMES:Edith Baer",
			"item4.X-ABLABEL:_$!<Brother>!$_",
			"item4.X-ABRELATEDNAMES:Randolf Baer",
			"END:VCARD",
		].join("\r\n");
		expect(parseRelations(card)).toEqual({
			Spouse: ["Susann Baer"],
			Mother: ["Edith Baer"],
			Brother: ["Randolf Baer"],
		});
	});

	test("keeps every name when a role appears more than once", () => {
		const card = [
			"BEGIN:VCARD",
			"FN:Jan Baer",
			"item1.X-ABLABEL:_$!<Child>!$_",
			"item1.X-ABRELATEDNAMES:Alice Baer",
			"item2.X-ABLABEL:_$!<Child>!$_",
			"item2.X-ABRELATEDNAMES:Bob Baer",
			"END:VCARD",
		].join("\r\n");
		expect(parseRelations(card)).toEqual({
			Child: ["Alice Baer", "Bob Baer"],
		});
	});

	test("records a person reached twice only once", () => {
		// X-SPOUSE and an item pair commonly name the same person.
		const card = [
			"BEGIN:VCARD",
			"FN:Jan Baer",
			"X-SPOUSE:Susann Baer",
			"item1.X-ABLABEL:_$!<Spouse>!$_",
			"item1.X-ABRELATEDNAMES:Susann Baer",
			"END:VCARD",
		].join("\r\n");
		expect(parseRelations(card)).toEqual({ Spouse: ["Susann Baer"] });
	});

	test("returns nothing for a card without relations", () => {
		expect(parseRelations("BEGIN:VCARD\r\nFN:Ada\r\nEND:VCARD")).toEqual({});
	});
});
