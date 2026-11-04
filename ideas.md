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

## Send a mix to Spotify

Mix lists are built (they live in Crate). This would send one to Spotify as a private playlist.

**How it would work:**
1. One time: you make a free Spotify developer app and give Crate its Client ID. No secret is needed.
2. Tap **Send to Spotify** on a mix, and sign in to Spotify once.
3. Crate searches Spotify for each track by artist and title, picks the best match, and creates the playlist.
4. Crate shows what it could not find, so you can fix those by hand.

**Honest limits:**
- Matches are best effort. Discogs lists the pressing (a 1973 original, a 2015 reissue). Spotify may offer a live, remastered or remix version instead. Check the playlist.
- Some tracks are simply not on Spotify, especially rare, white label and old records.
- Spotify controls new developer apps. Their rules for small apps change, so check the current limits (number of users, Premium needed) before building.
- Signing in on iPhone from a Home Screen app can be awkward. The return to the app may land in Safari. This needs testing on a real phone.
- Playback stays in the Spotify app. Crate only creates the playlist.

**Cheaper first step:** a **Share list** button already copies a mix as plain text. A plain text list can be pasted into free tools that build Spotify playlists.

## Smaller ideas

- Voice notes on a record: hold a button, say it, and it saves with the record. Works on iPhone and stays on the phone.
- Change a listing's price from inside the app. Today you edit it on Discogs.
- Pull in real sale prices from your Discogs orders, instead of using the asking price.
- Read the catalogue number from a photo of the label, to save typing. Not reliable, so keep it as a suggestion you confirm.
- Offer to remove a record from the Discogs collection when it sells, without asking each time.

_Last checked: auto deploy test._
