# Nimble PHP/MySQL shared-hosting release

This package contains the PHP 8.2+ and MySQL edition of Nimble. It is intended for ordinary shared hosting and does not require Node.js, Docker, SSH, or a VPS.

The PHP backend includes first-owner setup, login, secure database-backed sessions, CSRF and origin checks, owner/admin/editor/viewer roles, optimistic saves, media uploads, independent pages, templates, publishing, preview, contact forms, a team inbox, password changes, audit events, and database-backed rate limits.

## Build the package

Run this from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-php-release.ps1
```

The release is created outside the repository at `..\artifacts\nimble-php-release`. The package deliberately contains `config.example.php`, not a real `config.php`.

## Install on shared hosting

1. Create one MySQL database and one database user. Grant the user full access to that database.
2. Upload the contents of `nimble-php-release` to the document root for your domain.
3. Copy `config.example.php` to `config.php` in the hosting file manager.
4. Set `public_url` to the exact HTTPS URL of the site.
5. Fill in the MySQL host, database name, username, and password.
6. Replace `setup_token` with a long random value that is not used anywhere else.
7. Confirm PHP 8.2 or newer with `pdo_mysql`, `mbstring`, and `fileinfo` enabled.
8. Open `https://your-domain.example/login.html` and create the first owner with the private setup token.
9. Remove or replace the setup token in `config.php` after setup.
10. Publish a page, submit a contact form from the public site, and verify the protected inbox.

The application creates its tables on the first request. Drafts and publication metadata are stored in MySQL; uploaded media is stored in `storage/uploads`. The included `.htaccess` rules deny direct access to storage and configuration files, while the PHP router serves only approved public files.

## PHP limits

Set `upload_max_filesize` and `post_max_size` high enough for the media limit. The editor sends media as a JSON data URL, so `post_max_size` should be at least 22 MB. If the host imposes a lower limit, use YouTube, Vimeo, or another hosted-video URL for large videos.

## Shared-hosting operations

The PHP edition does not send email. Contact forms are saved to the protected team inbox. Keep the host's database and file backups enabled and periodically export a database backup through the hosting panel.

For a new site, the normal workflow is:

1. Create the owner account.
2. Sign in at `/builder.html`.
3. Add pages and blocks using the palette and drop zones.
4. Upload media or add video links.
5. Use **Templates** for starter designs and reusable site layouts.
6. Preview, save, and publish.
7. Use `/control-panel.html` to invite team members and review enquiries.

## Security checklist

- Use an owner password different from the hosting password.
- Never commit `config.php`, database credentials, uploads, or database dumps.
- Replace the setup token after first-owner setup.
- Keep PHP, MySQL, and the host control panel updated.
- Restrict access to backups because they contain account hashes and private contact messages.
- Use HTTPS and verify that the public URL in `config.php` matches the actual domain.
