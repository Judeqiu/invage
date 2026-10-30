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

The supplied checkout, payment and login screens remain prototypes, as
explained in `../DEVELOPER-HANDOFF.md`. No booking, payment or email backend
was introduced as part of hosting the supplied site.
