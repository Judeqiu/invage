# Homepage deployment

Public URL: https://velovest.lextok.com
Host: `kai` (15.204.118.66). Service: `velovest-homepage`.
This is separate from the portfolio application at chat.velovest.lextok.com.

Build from a clean, committed checkout on `main` using `npm ci`, `npm test`
and `npm run build` within `website`. The Nitro preset is `node-server`.
Deploy the complete `.output` directory into a commit-named release directory
under `/var/www/sites/velovest.lextok.com/releases/`, with a `SOURCE_COMMIT`
file. Verify its checksums and Node entry point before switching `current`.
Directories must be traversable by www-data. The service listens only on
127.0.0.1:5180. Install the adjacent systemd unit and include the adjacent
Caddyfile in `/etc/caddy/Caddyfile`; validate Caddy before reload.
Keep the previous release for rollback. Switch `current` atomically and
restart only `velovest-homepage`. DNS requires an A record for `velovest`
pointing to 15.204.118.66; Caddy obtains HTTPS once that record resolves.

The `/login` route redirects to the real workspace login at
`https://chat.velovest.lextok.com/login`, preserving query parameters. The
workspace uses `webui/login/shell.html` for the Academy design and mounts the
existing Utarus login form; credential submission and sessions remain on the
workspace origin. This shell is enabled only for the consultant profile.

The supplied checkout and payment screens remain prototypes, as explained in
`../DEVELOPER-HANDOFF.md`. No booking, payment or email backend was introduced.
