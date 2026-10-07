import base64
from email.message import EmailMessage
import unittest
from unittest.mock import patch

from src.futubull import imap_bridge


def message(sender, subject, content_type="application/pdf"):
    email = EmailMessage()
    email["From"] = sender
    email["To"] = "statements@example.com"
    email["Subject"] = subject
    email["Message-ID"] = "<statement-1@example.com>"
    email.set_content("Statement attached.")
    email.add_attachment(b"%PDF-1.4\nsynthetic", maintype="application", subtype="pdf",
                         filename="statement.pdf")
    if content_type != "application/pdf":
        email.get_payload()[-1].replace_header("Content-Type", content_type)
    return email.as_bytes()


class FakeMailbox:
    def __init__(self, *args, **kwargs):
        self.commands = []
        self.messages = {
            "1": message("Futu <statements@futu.example>", "Account statement"),
            "2": message("Someone <other@example.com>", "Account statement"),
        }

    def login(self, username, password):
        self.commands.append(("login", username, password))
        return "OK", [b"logged in"]

    def select(self, folder, readonly=False):
        self.commands.append(("select", folder, readonly))
        return "OK", [b"2"]

    def uid(self, command, *args):
        self.commands.append((command, *args))
        if command == "search":
            return "OK", [b"1 2"]
        uid, section = args
        raw = self.messages[uid]
        if "HEADER" in section:
            header = raw.split(b"\n\n", 1)[0] + b"\n\n"
            return "OK", [(f"1 (RFC822.SIZE {len(raw)} BODY[HEADER])".encode(), header)]
        return "OK", [(b"1 (BODY[]) ", raw)]

    def logout(self):
        self.commands.append(("logout",))


class ImapBridgeTests(unittest.TestCase):
    def test_fetches_only_matching_pdf_without_marking_messages_read(self):
        fake = FakeMailbox()
        with patch.object(imap_bridge.imaplib, "IMAP4_SSL", return_value=fake):
            result = imap_bridge.fetch({
                "host": "mail.example.com", "port": 993,
                "username": "statements@example.com", "password": "app-password",
                "folder": "INBOX", "sender": "statements@futu.example",
                "subject_contains": "statement",
            })
        self.assertEqual(len(result["attachments"]), 1)
        attachment = result["attachments"][0]
        self.assertEqual(attachment["uid"], "1")
        self.assertTrue(base64.b64decode(attachment["pdf_base64"]).startswith(b"%PDF-"))
        self.assertIn(("select", "INBOX", True), fake.commands)
        self.assertTrue(all("BODY.PEEK" in command[2] for command in fake.commands
                            if command[0] == "fetch"))
        self.assertNotIn(("fetch", "2", "(BODY.PEEK[])"), fake.commands)

    def test_rejects_non_pdf_content(self):
        self.assertEqual(imap_bridge._attachments(b"From: a@example.com\n\nNo PDF", "1", 100), [])


if __name__ == "__main__":
    unittest.main()
