# BinDrive (InvesterDrive)

File portal for each Utarus user. Files live under `data/drive/<user-slug>/`.

## Auth

- Each user has `user.auth_token` in their YAML (created by invite redeem / init_user).
- BinDrive tools require `owner_slug` + that `auth_token`.
- Prefer `get_user` / resolve from Telegram context, then pass slug + auth_token — never invent tokens.

## Portfolio reports

1. Prefer **`save_report`** — generates the 3-axis HTML analysis and writes it to BinDrive.
2. Prefer **`save_snapshot`** for dated JSON performance snapshots.
3. After save, always give the user the view URL (signed link when `UTARUS_REPORTS_URL` is set).

## Generic file ops

Framework tools: `bindrive_list`, `bindrive_upload`, `bindrive_download`, `bindrive_delete`.

Do not expose raw tokens or internal paths in chat.
