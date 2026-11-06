# Ideas

Things worth building later. Not done yet.

## Two way sync with Discogs

Today the app is the master copy. It sends changes to Discogs, but Discogs edits do not come back.

**What flows back today:** the one time import, prices, and listing status (when you tap Check Discogs).

**What does not flow back:**
- Records you add or remove on discogs.com after the import.
- Grade or note edits made on discogs.com.
- Price changes you make to a listing on Discogs.

**The idea:** a **Sync with Discogs** button, for example in Settings.

1. Read your whole Discogs collection (about 20 requests per 2,000 records).
2. Match each item to a record in the app by its Discogs collection ID.
3. New on Discogs: add it to the library.
4. Changed on Discogs: update grades and notes.
5. Gone from Discogs: do not delete anything. Flag the record and let you choose to keep it or remove it.
6. If you changed the same field on both sides, show both and let you pick.

**Open questions:**
- Which side wins when both changed? Suggest a "last changed" date per record and ask only when unsure.
- Should it run when the app opens, or only when you tap the button? Suggest the button, plus a reminder after a week.
- Records moved between Discogs folders. Treat as the same record.

## Spotify: what is built, and what could come next

Built: hearted tracks go to a private **Crate loved** playlist, and any mix can be sent to Spotify. See docs/SETUP.md.

Could come next:
- Remove a track from the playlist when you take its heart off.
- Add every track of a new vinyl to a playlist. Spotify playlists stop at 10,000 tracks, so this would need one playlist per year or per genre.
- A way to fix a wrong match by hand, by choosing from Spotify's search results.
- Save whole albums to your Spotify library instead of single tracks.

## The same library on every device

Crate keeps its data on each phone or computer separately. A new device starts empty. Today you move records with Back up everything on one device and Restore on the other. They do not stay in step afterwards.

The idea: an optional account so your records, grades, mixes and hearts follow you everywhere. It would need a small server and a login, which is a real step up in cost and care. The Discogs collection already holds a copy of the record list, so a lighter option is to import from Discogs on each new device.

## Smaller ideas

- Voice notes on a record: hold a button, say it, and it saves with the record. Works on iPhone and stays on the phone.
- Change a listing's price from inside the app. Today you edit it on Discogs.
- Pull in real sale prices from your Discogs orders, instead of using the asking price.
- Read the catalogue number from a photo of the label, to save typing. Not reliable, so keep it as a suggestion you confirm.
- Offer to remove a record from the Discogs collection when it sells, without asking each time.

_Last checked: auto deploy test._
