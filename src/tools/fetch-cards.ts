import type { DAVClient, DAVVCard } from "tsdav";

const pathOf = (href: string, base: string) =>
	decodeURIComponent(new URL(href, base).pathname).replace(/\/+$/, "");

/**
 * Discovers card hrefs with PROPFIND instead of tsdav's default
 * addressbook-query, whose condition-less FN prop-filter returns nothing on
 * Open-Xchange (mailbox.org).
 */
async function listCardUrls(
	client: DAVClient,
	addressBookUrl: string,
): Promise<string[]> {
	const responses = await client.propfind({
		url: addressBookUrl,
		props: { "d:resourcetype": {} },
		depth: "1",
	});
	const self = pathOf(addressBookUrl, addressBookUrl);
	const own = responses.find(
		(r) => r.href && pathOf(r.href, addressBookUrl) === self,
	);
	// tsdav returns failed requests as a single non-ok entry instead of throwing.
	if (own?.ok === false || responses.every((r) => !r.props)) {
		throw new Error(
			`Listing ${addressBookUrl} failed: ${own?.status ?? "unexpected response"} ${own?.statusText ?? ""}`.trim(),
		);
	}

	return responses.flatMap((r) =>
		r.ok &&
		r.href &&
		r !== own &&
		!Object.keys(r.props?.resourcetype ?? {}).includes("collection")
			? [r.href]
			: [],
	);
}

/** Fetches every card in the address book, retrying once if a card vanishes between listing and fetching. */
export async function fetchCards(
	client: DAVClient,
	addressBookUrl: string,
): Promise<DAVVCard[]> {
	const fetchFrom = (objectUrls: string[]) =>
		client.fetchVCards({ addressBook: { url: addressBookUrl }, objectUrls });
	const objectUrls = await listCardUrls(client, addressBookUrl);
	try {
		return await fetchFrom(objectUrls);
	} catch (err) {
		const relisted = await listCardUrls(client, addressBookUrl);
		if (objectUrls.every((url) => relisted.includes(url))) throw err;
		return fetchFrom(relisted);
	}
}
