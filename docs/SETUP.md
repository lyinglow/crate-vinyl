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
