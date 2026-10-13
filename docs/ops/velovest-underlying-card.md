# Velovest underlying premium card

The Net Option Premium by Underlying card keeps its Before fees note and explanation button inside the card footer. The first five underlying rows remain visible in their existing order. When more rows exist, Show more expands them and Show fewer collapses them. Cards with five or fewer rows have no empty expand control. Bar scaling uses the entire data set and does not change on expansion; calculations and broker filters are unchanged.

Target `victorconsultant` on `lextokprod02`, `/opt/victorconsultant`, services `victorconsultant` and `victorconsultant-drive`. Keep Utarus v4.2.13, account mode and database configuration. No SQL or configuration migration is required.

Verify the existing source mirror against its prior committed deployment. Deploy a clean, pushed Git archive with staging directory mode 0755 through Agent Ops fast-deploy. Quiesce Velovest ingress, gracefully stop and drain both writers, capture and verify the paired backup and encrypted off-server copy, then run `fast-deploy.sh victorconsultant --rsync-code --local-root=<committed staging> --services=victorconsultant,victorconsultant-drive`.

Check exact deployed source, framework version, database readiness, both service/local-login endpoints, public login and dashboard/report asset hashes. Verify first-five display, expansion/collapse, footer explanation hover, keyboard activation and narrow-screen fit. Save the deployment receipt before retaining only the newest complete deployment backup on the target host. Preserve broker/import and migration evidence. Rollback to the previous committed source through the same drain and canonical deploy process; no database downgrade is needed.
