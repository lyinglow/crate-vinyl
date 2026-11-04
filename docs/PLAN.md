# The plan

## What Crate is

A small app for your iPhone Home Screen. It holds your records as sleeves, adds new ones by scanning, and talks to Discogs for the details, prices and selling. Your data lives on your phone. Nothing sits on a server of mine.

## The honest answer on scanning

**Can a photo of a label identify a record? No, not reliably.**

- Discogs has no picture search. There is nothing to send a photo to.
- Reading the text off a label is hard. Labels are round, the type is curved and stylised, and older labels are worn. Text reading on a phone would give wrong answers often enough to cause bad matches.
- Even a perfect text read would not settle which pressing you hold. One album can have dozens of pressings with near identical labels.

**What works, best first:**

1. **Barcode.** Reliable on most records from the late 1980s on, and on reissues. One scan finds the exact release. This is the fast route.
2. **Catalogue number.** Printed on the label and usually on the spine. This is the best route for older records. You type it once, or just the first few characters.
3. **Artist and title.** Slower, and gives several pressings to choose from. Use it when the catalogue number is unreadable.
4. **By hand.** For white labels and anything Discogs does not have. You can match it to Discogs later.

**What the label photo does in Crate:** it is a visual check. In Search, you take a photo of the label and hold it next to the Discogs results to confirm the pressing. The photo is then saved with the record.

**Pressings:** after any match, tap **Other pressings** to see every vinyl pressing of that album, with country, year, label and catalogue number. Narrow the list by typing, for example "UK" or "1973". The run-out etchings on the Discogs page help settle the last doubts.

## What I could and could not test

Tested, against a stand-in for Discogs that follows the Discogs documentation: scanning, matching, adding, import of 230 records over three pages, grades and notes written back, other pressings, listing, sale detection, prices, rate limit waits, CSV, backup and restore, and offline use.

Tested for real: the barcode reader read a real EAN-13 barcode from a live camera feed in about a third of a second. Discogs accepts requests from a web page, including adding to a collection and listing.

**Not tested: your real Discogs account.** I had no token. Expect small surprises on first use. Try the checks at the end of this page.

## What Discogs does and does not share

| You asked for | What Discogs gives apps | What Crate does |
|---|---|---|
| Median, lowest and highest recent sale prices | Not available through the API. They appear only on the Discogs website. | Shows Discogs' price suggestion for each condition, the cheapest copy for sale now, and a link to the Discogs page where last sold, low, median and high are shown. |
| Collection value | Low, middle and high for your whole Discogs collection. | Adds up its own estimate per record at the grade you set. Also shows Discogs' own figure on request. |
| List on the marketplace | Yes. | Lists from the app, or saves a draft. You confirm before anything goes live. |

Price suggestions need your Discogs seller settings to be complete. Without them, Crate falls back to the cheapest price for sale.

## Rate limits

Discogs allows **60 requests a minute** when signed in. Browsers cannot read how many are left, so Crate counts its own. It sends at most about **54 a minute**, lets urgent requests (things you are waiting for) go first, and waits and retries if Discogs says slow down.

Bulk numbers for 2,000 records:

| Job | Requests | Time |
|---|---|---|
| Import your Discogs collection | 20 (100 per page) | under a minute |
| Prices for every record | 2,000 | about 40 minutes, in the background |
| Scanning one record | about 5, spread out | does not slow you down |

Everything is saved as it goes. If you close the app, it picks up where it stopped.

## How the pieces fit

- **Storage:** IndexedDB on the phone. Photos you take are shrunk before saving.
- **Safety:** the app asks iPhone to keep the data. You can back up to a file and export a CSV. Discogs also holds your list if you leave that option on.
- **Login:** your own Discogs token. It never leaves your phone except to Discogs.
- **Offline:** the app and your library open without a connection. Lookups and prices need one.

## First checks on your real account

1. Settings, Connect. Expect "Connected as" and your name.
2. Import. Expect your sleeves.
3. Scan one record you own. Expect the right sleeve. Add it.
4. Look at that record on discogs.com in your collection. Expect your grades in the Media and Sleeve condition fields.
5. Open a record, tap **For sale**. Expect price suggestions (if your seller settings are done). Tap **Save as a draft on Discogs** first. Check the draft appears on Discogs. Delete it there if you like.

If any of those fail, the message on screen says why. Send it to me and I will fix it.
