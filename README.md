# ISP Billing & Customer Management

A simple billing system for a Bangladesh ISP (about 500–5,000 customers), running entirely on
Cloudflare's free services.

| Part | Technology |
|---|---|
| Screens | React + Vite + Tailwind CSS + Recharts |
| Hosting | Cloudflare Pages |
| Backend (API) | Cloudflare Pages Functions |
| Database | Cloudflare D1 (SQLite) |
| Currency / time zone / languages | BDT (৳) · Asia/Dhaka · English + বাংলা |

## What it does

- **Dashboard** – customer counts, today's and monthly collection, outstanding bills, income, expenses, charts, date filter.
- **Customers** – add, edit, search, filter; profile page with invoice, payment and package history. Customer IDs (`C00001`…) are automatic.
- **Packages** – internet packages with speed and price.
- **Billing** – automatic monthly bills, manual invoices, one-time charges, partial / full / advance payments.
- **Payments** – Cash, bKash, Nagad, Rocket, Bank, Other; printable receipt; search and filter by collector and date.
- **Income & Expenses** – a simple cash record (it is *not* a double-entry balance sheet).
- **Reports** – 8 reports, each with **Print** and **Export CSV**.
- **Users** – Administrator and Billing Operator roles.
- **Settings** – ISP name, logo, address, billing date, due date, language, invoice/receipt format, data backup.
- **Activity History** – a permanent record of who did what.

### Rules the system always follows

- Money records are **never deleted**. A wrong payment is *reversed*, a wrong invoice is *voided*; both stay visible with the reason and who did it. The database itself blocks deletion.
- **No duplicate monthly bills.** The database allows only one live monthly bill per customer per month, so generating bills twice is harmless.
- **Old invoices never change** when a package price changes later.
- **Advance payments** are kept as the customer's advance and are used automatically for the next bill.
- **Online payments** (bKash/Nagad/Rocket/Bank) need a transaction ID and stay "Not verified" until someone confirms the money really arrived.
- Every permission is checked on the server, not only on the screen.

---

## 1. Run it on your own computer (Windows)

You need **Node.js 20 or newer** (download the "LTS" installer from https://nodejs.org) and **Git**
(https://git-scm.com). Then open **Command Prompt (CMD)** and run these one at a time:

```bat
git clone https://github.com/musfikurzony/ISP-Management-System.git
```
```bat
cd ISP-Management-System
```
```bat
npm install
```
```bat
npm run db:migrate:local
```
```bat
npm run dev
```

Now open **http://localhost:8788** in your browser.

- The first time, the screen asks you to **create the first administrator**. Choose a username and a password of at least 8 characters.
- `npm run db:migrate:local` creates a practice database inside the hidden `.wrangler` folder on your computer. It does not touch the real (online) database.
- To stop the program press `Ctrl + C` in the CMD window.
- To start again with an empty practice database, delete the `.wrangler` folder and run `npm run db:migrate:local` again.

Optional self-check (with `npm run dev` running in one CMD window, and a **fresh** practice database), in a second window:

```bat
npm test
```

It runs 75 automatic checks on login, billing, payments, reversals and permissions.

---

## 2. Put it online (Cloudflare Pages)

The two D1 databases already exist in the Cloudflare account and their IDs are in `wrangler.jsonc`:

| Database | Used by |
|---|---|
| `isp_billing_db` | the live site (production) |
| `isp_billing_db_preview` | test copies (preview), so experiments never touch real data |

Deployment is automatic through GitHub. You only do this setup **once**:

**Step 1 – Create a Cloudflare API token**

1. Go to https://dash.cloudflare.com/profile/api-tokens and press **Create Token**.
2. Choose **Create Custom Token** and give it these permissions:
   - Account → **Cloudflare Pages** → Edit
   - Account → **D1** → Edit
   - Account → **Workers Scripts** → Edit
3. Press **Continue to summary → Create Token** and copy the token (it is shown only once).

**Step 2 – Find your Account ID**

Open https://dash.cloudflare.com, click **Workers & Pages**; the **Account ID** is on the right side. Copy it.

**Step 3 – Give both to GitHub**

In the GitHub repository open **Settings → Secrets and variables → Actions → New repository secret** and add:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | the ID from step 2 |
| `BACKUP_PASSWORD` | a long password you invent (used to lock the nightly backups) |

**Step 4 – Deploy**

Open the **Actions** tab → **Deploy to Cloudflare Pages** → **Run workflow**.
After about two minutes the site is live at `https://isp-billing.pages.dev` (the exact address is shown in
Cloudflare under **Workers & Pages → isp-billing**).

From then on, every change pushed to the `main` branch is deployed automatically. Each deployment:
builds the screens → updates the database structure → publishes the site → installs the daily billing scheduler.

**Step 5 – First login**

Open the site and create the first administrator immediately (the setup screen works only once, while there are no users).
Then go to **Settings** and enter your ISP name, logo, address and billing date.

> Prefer to deploy from your own computer instead? Run `npx wrangler login` once, then
> `npm run db:migrate:remote` and `npm run deploy`.

---

## Install on a phone (like an app)

The site is an installable web app (PWA).

- **Android (Chrome):** open the site, then press the green **Install app** button (on the login page and in the top bar), or use Chrome menu ⋮ → **Add to Home screen → Install**.
- **iPhone (Safari):** press the **Share** button → **Add to Home Screen**.
- **Computer (Chrome / Edge):** press the install icon at the right end of the address bar.

The app then opens full-screen from its own icon. It still needs internet: billing data is always loaded live from the server and is never stored on the phone.

---

## 3. Automatic monthly billing

Set the **billing date** and **due date** in Settings.

- The small scheduled worker in `cron-worker/` runs every night at 01:05 (Bangladesh time) using a Cloudflare **Cron Trigger**. On the billing date it creates the month's bill for every **Active** customer.
- Safety net: if the scheduler is not installed, the same thing happens the first time anyone opens the Dashboard on or after the billing date.
- Customers added later in the month are not billed automatically for that month. Use **Billing → Generate monthly bills** (it skips everyone who already has a bill) or **New invoice**.

---

## 4. Backups

You have four layers:

1. **Cloudflare Time Travel** – always on. Cloudflare can restore the database to any minute of the last 7 days (free plan):
   `npx wrangler d1 time-travel restore isp_billing_db --timestamp=2026-01-31T10:00:00+06:00`
2. **Nightly automatic export** – the `Nightly database backup` GitHub workflow saves a password-locked `.7z` file every night (kept 30 days) under **Actions → the run → Artifacts**. Open it with 7-Zip and your `BACKUP_PASSWORD`.
3. **In-app download** – **Settings → Download data backup** (administrator only) saves all data as one file.
4. **Manual full export** from your computer:
   ```bat
   npm run backup
   ```
   This writes `backup.sql`. To load a backup into an empty database:
   `npx wrangler d1 execute isp_billing_db --remote --file=backup.sql`

Download a backup to your own computer or Google Drive at least once a week. Backup files contain customer data: keep them private.

---

## 5. Who can do what

| Action | Administrator | Billing Operator |
|---|:-:|:-:|
| Dashboard, reports, CSV, printing | ✔ | ✔ |
| Add / edit customers, change status | ✔ | ✔ |
| Create invoices, record payments | ✔ | ✔ |
| Record income and expenses | ✔ | ✔ |
| Delete a customer (only one with no invoices/payments) | ✔ | ✖ |
| Add / edit / delete packages | ✔ | ✖ |
| Generate monthly bills for everyone | ✔ | ✖ |
| Void invoices, reverse payments / income / expenses | ✔ | ✖ |
| Mark online payments as verified | ✔ | ✖ |
| Users, Settings, Activity History, Backup | ✔ | ✖ |

Security built in: passwords are stored hashed (PBKDF2-SHA256 with a random salt); sessions use an
HttpOnly, SameSite=Strict cookie and only a hash is stored; five wrong passwords lock the account for
15 minutes; all inputs are validated on the server; database access exists only inside Cloudflare (no
passwords or keys in this repository).

---

## Forgot a password?

- **Someone else is an Administrator:** they open **Users → Edit**, type a new password and save. That also unlocks the account.
- **You are the only Administrator and forgot your password (or username):** on your computer, in the project folder, run in CMD:

  ```bat
  npx wrangler login
  ```
  ```bat
  npm run reset-password
  ```

  `npx wrangler login` opens the browser once so you can sign in to Cloudflare (the same account that holds the database).
  The reset tool lists all usernames, asks which one to reset, and asks for a new password twice. The account is also unlocked,
  re-activated and signed out everywhere, and the reset is written to the Activity History.
  Only someone who can sign in to your Cloudflare account can do this, so keep that account's password safe.

- **Locked after 5 wrong passwords:** wait 15 minutes, or reset the password as above.

Tip: create a second Administrator account and keep its password somewhere safe, so you never depend on one password.

---

## 6. Where things are (for future changes)

```
migrations/            database structure (never edit an old file; add a new numbered file)
server/                backend code
  router.js            login check, role check, routing for every /api request
  billing.js           the billing rules (monthly generation, advance, recalculation)
  routes/              one file per module: customers, invoices, payments, reports ...
functions/api/         the Cloudflare Pages Function that hands requests to server/
src/                   screens (React)
  pages/               one file per screen
  lib/bn.js            Bangla translations
cron-worker/           optional nightly scheduler
scripts/               emergency password reset tool
tests/smoke.mjs        automatic end-to-end checks
wrangler.jsonc         Cloudflare configuration (production + preview)
.github/workflows/     automatic deploy and nightly backup
```

Money is stored as whole **paisa** (৳1 = 100) to avoid rounding errors. Dates are Asia/Dhaka calendar dates.

**Adding a module later** (MikroTik, OLT, SMS, reseller, customer portal, payment gateway, branches…):
add a new migration file, a new file in `server/routes/`, register it in `server/router.js`, and add a screen in
`src/pages/`. Existing modules do not need to be rewritten. None of those future features are in this
version, and no router or OLT passwords are stored anywhere.
