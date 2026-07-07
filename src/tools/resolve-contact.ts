import type { DAVClient, DAVVCard } from "tsdav";
import { hrefFor } from "./carddav-href.js";
import { parseVCard } from "./vcard.js";

/**
 * Finds the stored vCard for a contact UID. Tries the conventional
 * `<uid>.vcf` href first (how create-contact stores cards), then falls back
 * to scanning the address book for a matching UID property — cards created
 * by other clients may use any filename.
 */
export async function resolveContact(
	client: DAVClient,
	addressBookUrl: string,
	uid: string,
): Promise<DAVVCard> {
	const addressBook = { url: addressBookUrl };
	try {
		const [direct] = await client.fetchVCards({
			addressBook,
			objectUrls: [hrefFor(addressBookUrl, uid)],
		});
		if (
			direct &&
			typeof direct.data === "string" &&
			direct.data.length > 0 &&
			parseVCard(direct.data).uid === uid
		) {
			return direct;
		}
	} catch {
		// Fall through to the full scan; some servers reject multi-get for
		// hrefs that do not exist instead of reporting a 404 per href.
	}

	const all = await client.fetchVCards({ addressBook });
	const match = all.find(
		(card) =>
			typeof card.data === "string" && parseVCard(card.data).uid === uid,
	);
	if (!match) {
		throw new Error(`Contact not found: ${uid}`);
	}
	return match;
}
