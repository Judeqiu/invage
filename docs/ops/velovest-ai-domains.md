# Velovest.ai domains

Homepage: https://velovest.ai on kai (15.204.118.66), service
`velovest-homepage`, loopback port 5180. Chat: https://chat.velovest.ai
on lextokprod02 (15.204.91.163), services `victorconsultant` and
`victorconsultant-drive`, public chat upstream 3030.

Namecheap A records: `@` → 15.204.118.66; `chat` → 15.204.91.163.
Existing lextok.com hosts remain served during propagation. No www hostname
is configured by this migration. Caddy obtains certificates once public DNS
points to the correct servers. Preserve unrelated Caddy sites.

Use `website/deploy/Caddyfile` for the homepage site and
`ops/velovest-domains.caddy` for the chat site. Install
`ops/velovest-public-urls.conf` as `public-urls.conf` in both chat units'
`/etc/systemd/system/<unit>.service.d/` directories, then reload systemd.
These public URL variables override the old values in the protected .env
without copying or changing credentials. The landing URL keeps its existing
workspace registration role and therefore uses the chat origin.

Build the homepage from the committed source and activate a commit-named
release using the existing website deployment instructions. Preserve its
installation path and previous release. Deploy a clean committed export
to the verified chat source tree using agent-ops fast-deploy with --rsync-code
and an explicit --local-root for that export. Verify source hashes against the committed
baseline before and after replacing the shell, including unexpected code
files because the runtime installation has no .git directory.

Check homepage, sitemap, robots, login redirect with query preservation,
chat login links, signup proxy rejection of an empty payload, both chat
units and effective public URL environment variables. Check actual public
HTTPS separately from routing tests using an explicit origin IP. Sessions
are scoped to the hostname; users may need to log in on chat.velovest.ai.
No third-party provider configuration is changed here.
