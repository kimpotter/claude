"""Convert a Muspy Atom release feed into a clean iCalendar file (all-day events)."""
import datetime, hashlib, html, re, sys, urllib.request
import xml.etree.ElementTree as ET

A = "{http://www.w3.org/2005/Atom}"
TYPES = r"(Album|EP|Single|Compilation|Live|Remix|Soundtrack|Spokenword|Interview|Audiobook|Other|Broadcast|Mixtape/Street|DJ-mix|Demo)"

def esc(s):
    return s.replace("\\", "\\\\").replace(";", r"\;").replace(",", "\\,").replace("\n", "\\n")

def fold(line):
    b, out = line.encode(), []
    while len(b) > 75:
        i = 75
        while (b[i] & 0xC0) == 0x80:
            i -= 1
        out.append(b[:i].decode())
        b = b" " + b[i:]
    out.append(b.decode())
    return "\r\n".join(out)

def main(url, out):
    req = urllib.request.Request(url, headers={"User-Agent": "muspy-ical/1.0"})
    root = ET.fromstring(urllib.request.urlopen(req, timeout=60).read())
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//kimpotter//muspy-ical//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:New Releases (Muspy)",
             "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    n = 0
    for e in root.iter(A + "entry"):
        title = html.unescape((e.findtext(A + "title") or "").strip())
        date = (e.findtext(A + "updated") or e.findtext(A + "published") or "")[:10]
        if not title or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        content = e.find(A + "content")
        text = html.unescape(re.sub(r"<[^>]+>", " ", ET.tostring(content, encoding="unicode"))) if content is not None else ""
        m = re.search(r"\(\s*" + TYPES + r"\s*\)", text, re.I)
        rtype = m.group(1) if m else ""
        summary = title.replace(" - ", " – ", 1) + (f" ({rtype})" if rtype else "")
        d0 = datetime.date.fromisoformat(date)
        uid = hashlib.md5((date + title).encode()).hexdigest() + "@muspy-ical"
        lines += ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{now}",
                  f"DTSTART;VALUE=DATE:{d0:%Y%m%d}",
                  f"DTEND;VALUE=DATE:{d0 + datetime.timedelta(days=1):%Y%m%d}",
                  fold("SUMMARY:" + esc(summary)), "TRANSP:TRANSPARENT", "END:VEVENT"]
        n += 1
    if n == 0:
        sys.exit("No entries parsed; keeping previous calendar.")
    lines.append("END:VCALENDAR")
    with open(out, "w", newline="") as f:
        f.write("\r\n".join(lines) + "\r\n")
    print(f"Wrote {n} events to {out}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
