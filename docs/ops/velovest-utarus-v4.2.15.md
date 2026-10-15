# Velovest configurable reply verification

Deploy committed Invage `main` with `github:Judeqiu/utarus#v4.2.15` to `victorconsultant` on `lextokprod02`, `/opt/victorconsultant`, services `victorconsultant` and `victorconsultant-drive`. Public URL: `https://chat.velovest.lextok.com`. Read the framework v4.2.14 and v4.2.15 upgrade notes.

This upgrades schema 28 to 29 for private note attachments. Verify the source mirror against the previous committed deployment before changing it. Commit and push the pin and lockfile, then deploy from a clean Git archive with the matching locally installed framework. Quiesce only Velovest ingress, gracefully stop both services and confirm application/books database clients are drained. Capture and verify a paired source/configuration, framework, retained-file, system configuration and database backup, plus an encrypted verified off-server copy.

Run the v4.2.15 database migration and personal-mode readiness check with the existing protected environment and migration credentials before starting the updated runtime. Use Agent Ops `fast-deploy.sh victorconsultant --rsync-code --force-utarus --local-root=<committed staging> --services=victorconsultant,victorconsultant-drive`. Verify installed source and framework hashes, database readiness and local login before restoring ingress. Preserve existing account mode, encryption keys and provider credentials.

Reply verification defaults to off. After reloading the browser, admins can configure it at Management → Agent configuration → Utarus — Reply verification. The setting applies to subsequent reply publication without a restart. Check that the configuration API denies anonymous/non-admin writes and that the served WebUI includes the control. Existing regression tests cover enabling/disabling verification on cached agents and saving the control on desktop/mobile. Keep the production setting off for this deployment.

No new secrets or broker configuration changes are needed. Moli installation is independent and is not required for this change. After successful health checks, record a deployment receipt and retain only the newest complete deployment backup; preserve broker/import and migration evidence.

Rollback from schema 29 to the previous v4.2.13 deployment requires restoring the paired pre-upgrade SQL, file state, configuration and matching committed source/framework. Stop and drain writers first; a code-only downgrade cannot pass readiness. Reconcile any post-backup user writes before restoring.
