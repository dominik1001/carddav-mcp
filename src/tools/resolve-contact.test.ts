import type { DAVClient } from "tsdav";
import { describe, expect, test, vi } from "vitest";
import { resolveContact } from "./resolve-contact.js";

function vcardFor(uid: string): string {
	return `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:${uid}\r\nFN:Test\r\nEND:VCARD\r\n`;
}

describe("resolveContact", () => {
	test("returns the card at the conventional <uid>.vcf href", async () => {
		const card = { url: "/dav/contacts/abc.vcf", data: vcardFor("abc") };
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([card]),
		};

		const result = await resolveContact(
			mockClient as unknown as DAVClient,
			"/dav/contacts/",
			"abc",
		);

		expect(result).toBe(card);
		expect(mockClient.fetchVCards).toHaveBeenCalledTimes(1);
		expect(mockClient.fetchVCards).toHaveBeenCalledWith({
			addressBook: { url: "/dav/contacts/" },
			objectUrls: ["/dav/contacts/abc.vcf"],
		});
	});

	test("falls back to scanning the address book when the href misses", async () => {
		const card = { url: "/dav/contacts/other-name.vcf", data: vcardFor("abc") };
		const mockClient = {
			fetchVCards: vi
				.fn()
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{ url: "/dav/contacts/x.vcf", data: vcardFor("xyz") },
					card,
				]),
		};

		const result = await resolveContact(
			mockClient as unknown as DAVClient,
			"/dav/contacts/",
			"abc",
		);

		expect(result).toBe(card);
		expect(mockClient.fetchVCards).toHaveBeenCalledTimes(2);
	});

	test("falls back when the multi-get itself rejects", async () => {
		const card = { url: "/dav/contacts/other.vcf", data: vcardFor("abc") };
		const mockClient = {
			fetchVCards: vi
				.fn()
				.mockRejectedValueOnce(new Error("404"))
				.mockResolvedValueOnce([card]),
		};

		const result = await resolveContact(
			mockClient as unknown as DAVClient,
			"/dav/contacts/",
			"abc",
		);

		expect(result).toBe(card);
	});

	test("ignores an href hit whose UID does not match", async () => {
		const stale = { url: "/dav/contacts/abc.vcf", data: vcardFor("different") };
		const real = { url: "/dav/contacts/z.vcf", data: vcardFor("abc") };
		const mockClient = {
			fetchVCards: vi
				.fn()
				.mockResolvedValueOnce([stale])
				.mockResolvedValueOnce([stale, real]),
		};

		const result = await resolveContact(
			mockClient as unknown as DAVClient,
			"/dav/contacts/",
			"abc",
		);

		expect(result).toBe(real);
	});

	test("throws when the contact does not exist", async () => {
		const mockClient = {
			fetchVCards: vi.fn().mockResolvedValue([]),
		};

		await expect(
			resolveContact(
				mockClient as unknown as DAVClient,
				"/dav/contacts/",
				"missing",
			),
		).rejects.toThrow("Contact not found: missing");
	});
});
