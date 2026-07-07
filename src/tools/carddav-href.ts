/**
 * Builds the CardDAV object href (`<address book>/<uid>.vcf`) used to address
 * a single contact. Mirrors the filename create-contact uses when storing
 * cards, tolerating an address book URL with or without a trailing slash.
 */
export function hrefFor(addressBookUrl: string, uid: string): string {
	const base = addressBookUrl.endsWith("/")
		? addressBookUrl
		: `${addressBookUrl}/`;
	return `${base}${uid}.vcf`;
}
