import { describe, expect, test } from "vitest";
import { hrefFor } from "./carddav-href.js";

describe("hrefFor", () => {
	test("appends <uid>.vcf to an address book URL with a trailing slash", () => {
		expect(hrefFor("/dav/contacts/", "abc")).toBe("/dav/contacts/abc.vcf");
	});

	test("inserts the missing slash for an address book URL without one", () => {
		expect(hrefFor("/dav/contacts", "abc")).toBe("/dav/contacts/abc.vcf");
	});
});
