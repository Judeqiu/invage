# Velovest help bubbles and Questions input borders

Deploy Invage main with `github:Judeqiu/utarus#v4.2.13` to `victorconsultant` on `lextokprod02`, `/opt/victorconsultant`, services `victorconsultant` and `victorconsultant-drive`. Read the v4.2.13 framework upgrade note. No SQL migrations, configuration changes or new secrets are required.

Verify the existing source mirror against its previous committed deployment. Deploy only a clean, pushed source commit, using a Git archive staging directory with mode 0755 and locally installed matching Utarus. Quiesce only Velovest ingress, gracefully stop both services and drain the application/books database clients. Capture and verify the paired source/configuration, framework, file-state, service-definition and database backup, plus a verified encrypted off-server copy.

Use Agent Ops `fast-deploy.sh victorconsultant --rsync-code --force-utarus --local-root=<committed staging> --services=victorconsultant,victorconsultant-drive`. Verify every deployed source file, framework version and representative framework bundle hashes, database readiness and local login endpoints before restoring ingress. Check public login and the served dashboard/report assets. Retain a receipt with the newest complete backup and prune only the previous complete deployment backup, preserving broker/import and migration evidence.

Hover over every dashboard question mark to see the explanation immediately. Check keyboard focus, Escape dismissal, tap/outside-tap and narrow screens. The text explains month-to-date, premiums, brokerage fees, cash, assignment exposure, realized profit/loss and contract marks in everyday language, with examples where useful. Bubble text must remain inside the viewport and above tables/cards, including dynamically rendered cards. Metric calculations are unchanged.

Open a ticker question and focus its input. Check all four rounded border edges, text entry and the explicit Use question action on phone and desktop. The highlight is inset so the scrollable Questions panel cannot clip it. Timeline remains available and the dashboard starts on Open; date navigation and dashboard Refresh controls remain removed.

Rollback to the previous committed source and matching v4.2.12 package via graceful drain and canonical deployment. No SQL downgrade is needed. Preserve the paired backup and existing account/database configuration.
