"""Fetch Futubull statement PDFs from an IMAP mailbox without changing messages.

Only metadata for matching messages and their PDF attachments leaves this process.
The caller supplies credentials on stdin; they are never passed in argv or logged.
"""

import base64
from datetime import datetime, timezone
from email import policy
from email.parser import BytesHeaderParser, BytesParser
from email.utils import getaddresses
import imaplib
import json
import re
import ssl
import sys


MAX_SCANNED = 500
MAX_PDFS = 20
MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_MESSAGE_BYTES = 12 * 1024 * 1024
MARKER = "INVAGE_FUTU_MAIL_JSON:"


def _literal(response):
    for item in response or []:
        if isinstance(item, tuple) and isinstance(item[1], bytes):
            return item[1]
    return None


def _message_size(response):
    for item in response or []:
        if isinstance(item, tuple) and isinstance(item[0], bytes):
            match = re.search(rb"RFC822\.SIZE (\d+)", item[0])
            if match:
                return int(match.group(1))
    return None


def _check(result, label):
    status, data = result
    if status != "OK":
        raise RuntimeError(f"IMAP {label} failed")
    return data


def _matches(header_bytes, sender, subject_fragment):
    headers = BytesHeaderParser(policy=policy.default).parsebytes(header_bytes)
    addresses = {address.casefold() for _, address in getaddresses(headers.get_all("From", []))}
    if sender.casefold() not in addresses:
        return False
    subject = str(headers.get("Subject", ""))
    return not subject_fragment or subject_fragment.casefold() in subject.casefold()


def _attachments(message_bytes, uid, max_bytes):
    message = BytesParser(policy=policy.default).parsebytes(message_bytes)
    found = []
    for part in message.walk():
        if part.is_multipart():
            continue
        name = part.get_filename() or ""
        if part.get_content_type().lower() != "application/pdf" and not name.lower().endswith(".pdf"):
            continue
        payload = part.get_payload(decode=True)
        if not isinstance(payload, bytes) or not payload.startswith(b"%PDF-"):
            continue
        if len(payload) > MAX_PDF_BYTES or len(payload) > max_bytes:
            raise RuntimeError("Statement PDF exceeds the supported size limit")
        found.append({
            "uid": uid,
            "message_id": str(message.get("Message-ID", ""))[:256],
            "subject": str(message.get("Subject", ""))[:256],
            "date": str(message.get("Date", ""))[:128],
            "filename": name[:256] or "statement.pdf",
            "pdf_base64": base64.b64encode(payload).decode("ascii"),
            "size": len(payload),
        })
        max_bytes -= len(payload)
    return found


def fetch(request):
    host = request["host"]
    port = request["port"]
    username = request["username"]
    password = request["password"]
    folder = request["folder"]
    sender = request["sender"]
    subject_fragment = request.get("subject_contains", "")
    mailbox = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=20)
    try:
        _check(mailbox.login(username, password), "login")
        _check(mailbox.select(folder, readonly=True), "select")
        ids = _check(mailbox.uid("search", None, "ALL"), "search")
        uids = (ids[0] or b"").split()[-MAX_SCANNED:]
        found = []
        total = 0
        for uid_bytes in reversed(uids):
            uid = uid_bytes.decode("ascii")
            header_response = _check(mailbox.uid("fetch", uid, "(RFC822.SIZE BODY.PEEK[HEADER])"), "header fetch")
            size = _message_size(header_response)
            if size is None or size > MAX_MESSAGE_BYTES:
                continue
            headers = _literal(header_response)
            if not headers or not _matches(headers, sender, subject_fragment):
                continue
            body = _literal(_check(mailbox.uid("fetch", uid, "(BODY.PEEK[])"), "message fetch"))
            if not body:
                continue
            items = _attachments(body, uid, MAX_TOTAL_BYTES - total)
            found.extend(items)
            total += sum(item["size"] for item in items)
            if len(found) >= MAX_PDFS or total >= MAX_TOTAL_BYTES:
                break
        return {"fetched_at": datetime.now(timezone.utc).isoformat(), "attachments": found[:MAX_PDFS]}
    finally:
        try:
            mailbox.logout()
        except (imaplib.IMAP4.error, OSError):
            pass


def main():
    try:
        request = json.load(sys.stdin)
        result = fetch(request)
    except imaplib.IMAP4.error:
        result = {"error": "IMAP login or mailbox command failed. Check the app password and mailbox folder."}
    except (OSError, ssl.SSLError):
        result = {"error": "Cannot connect securely to the IMAP mailbox."}
    except RuntimeError as error:
        result = {"error": str(error)}
    except Exception:
        result = {"error": "Futubull mail reader failed while processing the mailbox."}
    print(MARKER + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
