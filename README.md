# Nimble

Nimble is a self-hosted, production-oriented website builder for people who want the ease of a visual builder without giving up ownership of their code, content, or hosting.

It includes a visual editor, independent pages, reusable templates, media and video support, responsive previews, publishing, team access, a contact inbox, and both Node/SQLite and PHP/MySQL deployment options.

## What you can build

- Pages made from text, hero, image, button, video, services, split, call-to-action, gallery, columns, quote, and contact-form blocks.
- New pages, custom page paths, connected navigation, draft saving, undo/redo, preview, and one-click publishing.
- Reusable templates: start from a template, save your own designs, apply them to a site, and manage them from the template manager.
- True drag-and-drop editing: drag a block from the palette into any visible drop zone, or drag the handle on an existing block to place it anywhere on the page.
- Image uploads, MP4/WebM uploads, YouTube/Vimeo embeds, external media links, and a managed media library.
- Site settings for name, description, search visibility, social image, colours, fonts, and corner styles.
- Protected owner, admin, editor, and viewer access, with session revocation, audit events, and a team control panel.
- Contact forms that deliver enquiries to the protected control-panel inbox.
- Draft import/export and safe optimistic saves so two editors do not silently overwrite one another.

Nimble is a single-site application. It is not a multi-tenant SaaS product and does not include billing, email password delivery, two-factor authentication, or external object storage.

## Choose a deployment

| Use case | Recommended edition | Requirements |
| --- | --- | --- |
| Try it locally or develop features | Node/SQLite | Node.js 24+ and npm |
| A VPS, cloud VM, or Docker host | Node/SQLite + Docker/Caddy | Docker Compose, a domain, and ports 80/443 |
| Shared hosting without a VPS | PHP/MySQL release | PHP 8.2+, MySQL, and PDO MySQL |

The PHP/MySQL route is the simplest choice when the host does not provide Docker, SSH, or a VPS. See [PHP_SHARED_HOSTING.md](PHP_SHARED_HOSTING.md) for the host-specific checklist.

## Run locally

### Prerequisites

- Node.js 24 or newer
- npm
- A modern browser

### Install and start

```bash
git clone https://github.com/HakonHakon/Nimble.git
cd Nimble
npm ci
npm start
```

Open [http://localhost:4173/login.html](http://localhost:4173/login.html). On the first local run, create the owner account shown by the setup screen. No database or separate service is needed: the local edition creates its SQLite database and storage folders automatically.

Useful local URLs:

- `/login.html` — sign in or create the first owner
- `/builder.html` — visual website builder
- `/editor.html` — the new element editor (preview): iframe canvas, layers, per-breakpoint design. Opening a classic site here converts it to the v2 format on the first change; see [docs/site-format-v2.md](docs/site-format-v2.md)
- `/control-panel.html` — team members and contact enquiries
- `/` — the public site after the first publish
- `/api/health` — process health
- `/api/ready` — application readiness

### The basic workflow

1. Sign in and open the builder.
2. Use **Pages** to add pages and choose their addresses.
3. Use **Build** to click a block into the page or drag it from the palette to the exact drop zone you want.
4. Select a block to edit its text, links, images, video, colours, and cards.
5. Drag the `⠿` handle on any block to another drop zone to reorder it. There are no up/down controls to hunt through.
6. Open **Templates** to use a starter design or save a reusable template from your current site.
7. Use **Media** for uploads and **Styles** or **Settings** for site-wide changes.
8. Use **Preview** to check the result, then choose **Publish** when the public site should change.
9. Open **Control panel** to invite team members, assign roles, change passwords, and read contact enquiries.

Saving a draft does not publish it. Contact forms are disabled in the editor preview; submit them from the published site when testing delivery to the inbox.

## Test the application

Install the browser used by the end-to-end tests, then run the complete suite:

```bash
npm ci
npx playwright install chromium
npm test
```

The focused suites are also available:

```bash
npm run test:server
npm run test:browser
```

The tests use disposable storage and accounts. They do not use a production database or uploaded media.

## Deploy to a Docker host

This edition runs the Node/SQLite application behind Caddy, which obtains and renews HTTPS certificates. The application container is private; only Caddy publishes ports 80 and 443.

### Requirements

- Docker Engine with Docker Compose v2
- A DNS `A`/`AAAA` record pointing your domain to the host
- Firewall access to ports 80 and 443
- A production owner email and a unique password of 12–256 characters

### Configure and deploy

```bash
cp .env.example .env
```

Edit `.env` before starting. At minimum, set:

```dotenv
NIMBLE_DOMAIN=www.example.com
NIMBLE_PUBLIC_URL=https://www.example.com
NIMBLE_ADMIN_NAME=Site owner
NIMBLE_ADMIN_EMAIL=owner@example.com
NIMBLE_ADMIN_PASSWORD=use-a-unique-password-at-least-12-characters
```

The `NIMBLE_*` names are the application configuration names and can be changed to match your own deployment conventions.

Start the deployment:

```bash
docker compose -f docker-compose.production.yml up -d --build --wait
docker compose -f docker-compose.production.yml ps
```

For the full preflight, build, health check, and HTTPS verification use:

```bash
# Windows PowerShell
.\deploy.ps1

# Linux/macOS
bash ./deploy.sh
```

The deployment scripts validate the public HTTPS origin, build the image, wait for the application to be healthy, and check the real public readiness endpoint. Caddy can issue its certificate only after DNS and firewall access are correct.

Do not run `docker compose down --volumes` on a live installation unless you intentionally want to remove the named application and backup volumes.

### Backups and restore

The backup service creates a snapshot on startup and every 24 hours, retaining the latest 14 valid snapshots. Copy backups off the host using your normal backup system.

Create a manual snapshot:

```bash
docker compose -f docker-compose.production.yml exec studio node scripts/backup.mjs
```

Inspect the backup service:

```bash
docker compose -f docker-compose.production.yml logs --tail=50 backup
```

Restore only after stopping both writers, and replace `EXACT-SNAPSHOT-DIRECTORY` with a verified snapshot path:

```bash
docker compose -f docker-compose.production.yml stop studio backup
docker compose -f docker-compose.production.yml run --rm --no-deps \
  -e NIMBLE_ALLOW_RESTORE=yes studio node scripts/restore.mjs \
  /backups/EXACT-SNAPSHOT-DIRECTORY
docker compose -f docker-compose.production.yml up -d --wait studio backup
```

After a restore, verify login, the builder, uploaded media, published pages, and the contact inbox.

## Deploy to PHP/MySQL shared hosting

This option does not require Node.js, Docker, SSH, or a VPS.

Build the upload package from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-php-release.ps1
```

The generated package is written to `..\artifacts\nimble-php-release`. Upload its contents to the domain's document root, then:

1. Create a MySQL database and a database user, granting that user full access to the database.
2. Copy `config.example.php` to `config.php` in the document root.
3. Set the public URL, database host/name/user/password, and a long private setup token in `config.php`.
4. Confirm PHP 8.2+ with `pdo_mysql`, `mbstring`, and `fileinfo` enabled.
5. Open `/login.html` and create the first owner using the private setup token.
6. Remove or replace the setup token after the owner account exists.
7. Publish a page, submit a public contact form, and verify the control-panel inbox.

The PHP application creates its tables on the first request and stores uploaded media below `storage/`. The included access rules block direct access to configuration, database, and storage files. Keep hosting and database backups enabled; the Node backup daemon is not used by this edition.

See [PHP_SHARED_HOSTING.md](PHP_SHARED_HOSTING.md) for PHP limits, security notes, and the complete shared-hosting checklist.

## Support Nimble

Nimble is free and open source. If it is useful to you and you would like to support continued maintenance, you can buy us a coffee:

- [Send support via Revolut](https://revolut.me/hsadeghiafzal)

- [Send support via PayPal](https://paypal.me/HakonAfzal)

  ![PayPal QR code](docs/paypal-qr.svg)

## Security and operations

- Never commit `.env`, `config.php`, database files, uploads, backups, or private setup tokens.
- Use HTTPS in production and set the public URL to the exact HTTPS origin.
- Use a unique owner password that is different from the hosting-account password.
- Rotate the setup token after first-owner creation.
- Give editors and viewers only the access they need. Owner/admin role changes and password changes revoke affected sessions.
- Contact messages and backups contain private data; restrict access and copy backups to protected storage.
- If the owner is locked out of the Node edition, an authorised operator can use `scripts/reset-owner.mjs` with `NIMBLE_OWNER_NEW_PASSWORD` supplied only for that command. Never place the password in a committed file or shell history.

The repository includes security headers, CSRF and origin checks, login throttling, opaque hashed sessions, password hashing with scrypt, optimistic revision checks, safe public-file routing, and atomic publication. These controls reduce common risks but do not replace host hardening, backups, monitoring, or an application security review.

## Repository layout

```text
builder.html                   Visual editor
control-panel.html             Team and inbox control panel
login.html                     Authentication and first-owner setup
server.mjs                     Node/SQLite HTTP application
php-backend/                   PHP/MySQL shared-hosting application
assets/                        Editor, public-site, and control-panel assets
lib/                           Shared document validation and rendering
scripts/                       Backup, restore, reset, release, and checks
test/                          Server, browser, security, and deployment tests
docker-compose.production.yml  Docker/Caddy production stack
PHP_SHARED_HOSTING.md          Shared-hosting installation guide
```

## License

Nimble is released under the [MIT License](LICENSE). You may use, modify, self-host, and sell software based on it, including for commercial projects, as long as the copyright and license notice remains with copies or substantial portions of the software. Third-party packages and assets remain under their own licenses.
