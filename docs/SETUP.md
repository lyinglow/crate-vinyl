# Set up Crate

Time needed: about 15 minutes. Cost: £0.

You need an iPhone, a Discogs account, and a computer or phone to upload one folder.

## Step 1. Get your Discogs token

1. Sign in at discogs.com.
2. Go to discogs.com/settings/developers.
3. Tap **Generate new token**.
4. Copy the long code. Keep it private. It lets an app act as you.

## Step 2. Put the app online

The app is the files at the top of this repo. It needs a web address so your iPhone can open it. Pick one.

**Netlify (easiest)**
1. Go to app.netlify.com and make a free account.
2. Open **Sites**, then **Add new site**, then **Deploy manually**.
3. Drag this folder onto the page.
4. Netlify gives you an address ending in `.netlify.app`. Copy it.

**Vercel (this repo is ready for it)**
1. In Vercel, choose **Add New**, then **Project**, then pick this GitHub repo.
2. Leave every setting as it is. There is no build step.
3. Tap **Deploy**. Vercel gives you an address ending in `.vercel.app`.

**Cloudflare Pages (also free)**
1. Go to dash.cloudflare.com, then **Workers & Pages**, then **Create**, then **Pages**, then **Upload assets**.
2. Upload this folder.

Your records are never on this web address. They stay on your phone. The address only holds the app itself.

## Step 3. Add it to your Home Screen

1. Open the address in **Safari** on your iPhone.
2. Tap the Share button, then **Add to Home Screen**.
3. Open Crate from the new icon.

Do this before you add records. Records saved from the Home Screen icon are kept safe by iPhone. Records saved in a Safari tab can be cleared after a week of not using it.

## Step 4. Connect Discogs

1. Paste your token and tap **Connect**.
2. If you already keep a collection on Discogs, tap **Import my Discogs collection**. This brings in every sleeve in about a minute.
3. Prices then load in the background. 2,000 records take about 40 minutes. Keep the app open and the screen on.

## Step 5. Get ready to sell (when you want to)

Prices by condition and listing both need a Discogs seller account.

1. On discogs.com, open **Settings**, then **Selling**.
2. Fill in your payment and shipping details.
3. Set your currency to GBP.

Until then, Crate shows the cheapest price for sale, and you can still mark records for sale inside the app.

## Connect Spotify (optional)

Crate can put the tracks you heart into a private Spotify playlist called **Crate loved**, and send any mix to Spotify as its own playlist.

**One time setup**
1. Go to `developer.spotify.com/dashboard` and open your app.
2. In its settings, add this **Redirect URI** exactly, then save: `https://crate-vinyl-pixelhaus.vercel.app/`
3. Copy the app's **Client ID**. It is 32 letters and numbers. Never use the Client secret.
4. Open Crate from your Home Screen. Go to **Settings**, then **Spotify**. Paste the Client ID and tap **Connect Spotify**.
5. Sign in to Spotify and tap **Agree**.

**If you land on a page that says "Almost there"**
On iPhone, Spotify sometimes returns you to a different window from the one Crate opened. That window shows a short code. Tap **Copy the code**, close the window, and open Crate again. In **Settings**, **Spotify**, open **Came back from Spotify with a code?**, paste the code and tap **Use this code**.

**Using it**
- Tap the heart on a track. A moment later it is on your **Crate loved** playlist. A green tick means it is on Spotify. A grey cross means Spotify did not have it.
- Open a mix and tap **Send to Spotify**. Tap it again later to add tracks you added since.
- **Settings**, **Spotify**, **Add my loved tracks now** sends every heart you already have.
- Taking a heart off does not remove the track from the playlist. Do that in Spotify.

**Things to know**
- Crate searches Spotify for each track. It prefers the studio version and skips live, remix and instrumental versions unless that is what Discogs lists. Check the playlist now and then.
- It only adds while Crate is open, so leave the app open for a moment after hearting.
- A Spotify playlist holds up to 10,000 tracks.
- Spotify limits new developer apps. If sign in is refused, check your app's settings on the Spotify dashboard.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Discogs did not accept your token" | Copy the token again. Make sure you copied all of it. |
| Camera stays black | iPhone Settings, then Safari, then Camera, then allow. Or open from the Home Screen icon. |
| "Could not reach Discogs" | Check your connection. Crate carries on when you are back online. |
| Prices look low or missing | Complete your seller settings on Discogs, then Settings, then **Check every price again**. |

## Backups

Do this every few weeks. It takes five seconds.

- **Settings, Back up everything** saves a file with all records and photos. Send it to Files or iCloud Drive.
- **Settings, Export to a spreadsheet** saves a CSV you can open in Excel or Numbers.
- If you leave "Add it to my Discogs collection too" on, Discogs also holds your list, with your grades and notes.

## Costs, in pounds

| Item | Cost |
|---|---|
| Crate | £0 |
| Hosting on Netlify or Cloudflare Pages | £0 |
| Discogs API | £0 |
| Your own web address (optional) | about £10 a year |
| Discogs selling fees | Taken from each sale. Check the rate in your Discogs seller settings. |
