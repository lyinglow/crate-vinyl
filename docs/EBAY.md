# eBay prices for your equipment

Time needed: about 15 minutes, once. Cost: £0.

Crate can ask eBay UK what a piece of your gear is listed for. It shows how many are for sale, the typical asking price, and the range. It uses **asking prices of live listings**, not what things sold for. Sold prices are usually lower, so the **Sold on eBay** search button is still the honest check.

eBay's secret key must never sit inside the app. So Crate asks a small helper on your own Vercel site (`api/ebay.js`), and that helper asks eBay. Only someone signed in to your Crate sync can use it.

## Step 1. Get your eBay production key

1. Sign in at **developer.ebay.com** and open **Application Keys**.
2. Find the **Production** column and create a keyset. You get two codes: the **App ID (Client ID)** and the **Cert ID (Client Secret)**.
3. eBay may say the keyset is disabled until you handle **Marketplace Account Deletion**. Choose to opt out (exempt) and give a reason such as: "I only read public listing prices for a personal tool. I do not store any eBay user data." Save. The keyset becomes active, sometimes after a short wait.

## Step 2. Give the codes to Vercel (not to anyone else)

Never paste the Cert ID into a chat or an email. Put it only in Vercel.

1. Open your project at **vercel.com**, then **Settings**, then **Environment Variables**.
2. Add these four, for **Production**:

| Name | Value |
|---|---|
| `EBAY_CLIENT_ID` | the App ID (Client ID) |
| `EBAY_CLIENT_SECRET` | the Cert ID (Client Secret). Mark it **Sensitive**. |
| `SUPABASE_URL` | your Supabase Project URL (the one you pasted into Crate sync) |
| `SUPABASE_ANON_KEY` | your Supabase public key (the same one) |

3. Open **Deployments**, then the three dots on the latest one, then **Redeploy**. The new values only apply to a new deployment.

## Step 3. Try it

In Crate, sign in under **Settings**, **Sync across devices**. Then open **Equipment**, open an item that has a brand and model, and tap **Check eBay now**. **Check all on eBay** on the Equipment page does every item.

## If something goes wrong

| What you see | What it means |
|---|---|
| "eBay prices are not switched on for this site yet" | The helper is not deployed. Check that `api/ebay.js` is in your repository, then redeploy. |
| "eBay is not set up yet" | `EBAY_CLIENT_ID` or `EBAY_CLIENT_SECRET` is missing in Vercel, or you have not redeployed. |
| "Crate cannot check who you are yet" | `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing in Vercel. |
| "Sign in to Crate sync first" | Sign in under Settings, Sync across devices. |
| "eBay would not give Crate a key" | The codes are wrong, or the production keyset is not active yet. Check Step 1 and wait a little. |
| "eBay refused the search" | The Browse API is not switched on for your keys. Check your keyset on the eBay developer site. |
| "Nothing on eBay UK matched that" | Try a shorter name, for example the model number only. |

## What it does and does not do

- It searches eBay UK only, in pounds.
- It leaves out listings for spares, repairs, belts, boxes and manuals, and anything that does not match your brand and model. A cartridge keeps those, since they can be the item itself.
- The middle figure is the median, and the range is the middle half of the listings. A few silly prices do not move it.
- Nothing from eBay is stored on the server. Crate keeps the last figures on your device.
- It is limited to 150 lookups an hour, to keep well inside eBay's daily allowance.
- Use it for your own information. eBay's terms do not allow republishing its data.
