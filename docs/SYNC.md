# Sync across devices

Time needed: about 15 minutes, once. Cost: £0.

Crate keeps your collection on each device. Sync puts a copy in your own free Supabase project, so your records, grades, hearts, mixes and photos follow you to every phone and computer. You hold the keys. Nobody else's server is involved.

## What is shared, and what is not

**Shared:** records, grades, notes, hearts, wanted list, mixes, photos, and a few settings (such as the background and the Dig lists).

**Never uploaded:** your Discogs token and your Spotify keys. Enter those on each device.

Your data is stored readable in your Supabase project. That means you and Supabase can read it. Nobody else can: each row is locked to your account.

## Step 1. Make a project

1. Go to **supabase.com** and sign in.
2. Choose **New project**. Name it `crate`. Make up a database password and keep it somewhere safe. Pick the region nearest you (for the UK, London or Ireland). Choose the Free plan.
3. Wait a minute for it to finish setting up.

## Step 2. Set up the database

1. In Supabase, open **SQL Editor**, then **New query**.
2. In Crate, open **Settings**, then **Sync across devices**, then tap **Copy the setup script**.
3. Paste it into the query and tap **Run**. It should say it succeeded.

You can run it again at any time. It does not delete anything.

## Step 3. Choose how sign up works

Open **Authentication**, then **Sign In / Providers**, then **Email**.

- For just you, turn **Confirm email** off. Sign up is then instant.
- If you leave it on, Supabase emails a link when you create the account. Tap it, then sign in.

Open **Authentication**, then **URL Configuration**, and set **Site URL** to your Crate address, for example `https://crate-vinyl-pixelhaus.vercel.app`. This makes the password reset email work.

## Step 4. Copy two things into Crate

In Supabase, open **Project Settings**, then **API**. Copy:

- **Project URL**, which looks like `https://abcdefgh.supabase.co`
- The public key (called `anon` or `publishable`). It is safe to keep in the app. Never use the `service_role` or secret key.

In Crate, **Settings**, **Sync across devices**: paste both, tap **Save**, then enter your email and a password and tap **Create account**.

Crate uploads everything. 2,000 records take a few minutes. Keep it open.

## Step 5. Add your other devices

On the first device, tap **Link another device**. It copies a link. Open that link on the other device (message it to yourself). It fills in the project details. Then sign in with the same email and password. Everything arrives.

On a computer, open your Crate address in the browser and do the same.

## How it behaves

- Crate syncs when you open it, a few seconds after a change, and every minute while it is open.
- If you change the same record on two devices, the newest change wins.
- Deleting a record on one device deletes it everywhere.
- Photos download to a device the first time it needs them.
- Only the device that made a record adds it to your Discogs collection. The others wait for it to arrive. That stops duplicates in Discogs.
- Changes you make while signed out are not tracked. If you delete a record while signed out, it can come back when you sign in.

## If something goes wrong

| What you see | What to do |
|---|---|
| "The database is not set up yet" | Run the setup script again (Step 2). |
| "Invalid login credentials" | Check the email and password. Use **Forgot password** if needed. |
| "Please sign in again" | Your session ran out. Sign in again. Nothing is lost. |
| Nothing syncs after a week away | Free Supabase projects can pause after a week without use. Open the Supabase dashboard and restore the project. Your data is kept. |
| A photo does not appear | It downloads when first viewed. Check you are online. |

## Backups still matter

Sync is a second copy, not a backup. A mistake made on one device is copied to the others. Keep making a backup file now and then (Settings, Back up everything).
