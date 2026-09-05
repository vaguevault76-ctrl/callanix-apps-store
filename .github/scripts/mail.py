"""Send queued app-ID emails via SMTP (stdlib only, no dependencies).

Queue file .mail.json is written by publish.mjs report phase:
[{"to": ..., "subject": ..., "body": ...}].
SMTP_* comes from GitHub Secrets (owner sets once). Port 465 = SSL,
anything else = STARTTLS.
"""
import json
import os
import smtplib
import ssl
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
QPATH = os.path.join(BASE, ".mail.json")


def main():
    try:
        with open(QPATH, encoding="utf-8") as f:
            queue = json.load(f)
    except FileNotFoundError:
        print("mail: no queue file, nothing to send")
        return 0
    if not queue:
        print("mail: empty queue, nothing to send")
        return 0
    host = os.environ.get("SMTP_HOST", "")
    port = int(os.environ.get("SMTP_PORT") or "465")
    user = os.environ.get("SMTP_USER", "")
    pw = os.environ.get("SMTP_PASS", "")
    sender = os.environ.get("SMTP_FROM") or user
    if not (host and user and pw):
        print("mail: SMTP not configured, skipping")
        return 0
    from email.message import EmailMessage

    sent = 0
    ctx = ssl.create_default_context()
    for m in queue:
        to = (m.get("to") or "").strip()
        if "@" not in to:
            continue
        msg = EmailMessage()
        msg["From"] = sender
        msg["To"] = to
        msg["Subject"] = m.get("subject") or "Callanix Store"
        msg.set_content(m.get("body") or "")
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ctx) as s:
                s.login(user, pw)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port) as s:
                s.starttls(context=ctx)
                s.login(user, pw)
                s.send_message(msg)
        sent += 1
    print(f"mail: sent {sent}/{len(queue)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
