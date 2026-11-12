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

## Wanted list: what could come next

Built: a Wanted list, separate from your collection. Choose Wanted list under Adding to when you scan, search or add by hand. Wanted records go on your Discogs wantlist, show the cheapest price and how many are for sale, and move to your library with I got it.

Could come next:
- **A Spotify playlist for wanted tracks, both ways.** Out: a private "Crate wanted" playlist with the tracks of every wanted record. In: a "To hunt" playlist. Add a track to it in Spotify, and the next time you open Crate it searches Discogs for vinyl with that track and asks you to pick the pressing, then adds it to Wanted. Spotify cannot tell Crate when something changes, so Crate would check when it is open.
- **Price alerts.** Set a price you will pay for a wanted record. Crate flags it when the cheapest copy on Discogs drops to that or below. It can only check while the app is open, since an iPhone Home Screen app cannot run in the background.
- **Buying links for each wanted record.** Today there is one link to the release's for sale page on Discogs. Discogs does not let an app list the individual copies for sale, only the cheapest price and the count.
- Sync the other way: records added to your Discogs wantlist on discogs.com appear in Crate. Same plan as the collection sync above.

## Find similar tracks: by decade, genre, tempo and feel

Built (first version): profiles for tracks matched on Spotify (Settings, Tempo and feel, and automatically when you open a record), a Similar button on each track, and Make a mix from the results. Still to do: Mix by feel as its own page, and joining it with Dig.

Spotify closed its own tempo and mood data to new apps in November 2024, so Crate cannot ask Spotify. A free service called ReccoBeats gives the same kind of numbers (tempo, energy, danceability, mood, acoustic or not) when given a Spotify track, and a browser can call it. Tested on one known track: it returned a tempo of 123 BPM and the rest. Deezer also has a tempo field but it is empty for many tracks.

The plan:
- Each track Crate has matched on Spotify gets a profile: tempo, energy, mood. Fetched in batches in the background.
- A "Similar" button on a track lists tracks from your own collection that share its decade (or year), genre or style, a tempo within a few BPM (half and double time count), and a similar feel. Closest first.
- Make a mix from the list, and send it to Spotify with the button that already exists.
- A "Mix by feel" page: pick a decade, a genre, a tempo range and a mood, and see what you own.

Limits: only tracks that match on Spotify and that ReccoBeats knows. Obscure dance records will have gaps. The year is the year of your pressing, so a 1995 reissue of a 1980 record counts as 1995. ReccoBeats is a small free service with no promise it will stay.

## Dig: what is built, and what could come next

Built: a Dig page. Pick a decade and a style, and Crate asks Discogs for the vinyl from each year, groups the pressings, leaves out what you own, and ranks the rest by how many Discogs members own it, want it, or want it for each one that owns it. Listen plays the Discogs video. Want it puts it on the wanted list.

Could come next:
- Add real chart lists for the years Crate cannot rank well. The UK Official Charts keep dance charts from 1994 but offer no open data, so this would be a hand-built list, for example from Wikipedia's year by year number ones.
- Look deeper than the first 100 pressings of each year, and narrow by country (UK only).
- Pair it with the similar tracks idea above: dig for records that share a tempo and feel with a track you love.
- Show which labels and artists keep turning up in the results, so you can dig by label.

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
