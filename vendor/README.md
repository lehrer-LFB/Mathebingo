# Fremdbibliotheken (lokal eingebunden, keine CDNs)

| Ordner | Herkunft | Version | Lizenz |
|---|---|---|---|
| `qrcode-generator/qrcode-1.4.4.js` | npm `qrcode-generator` (Kazuhiko Arase) | 1.4.4 | MIT, siehe `qrcode-generator/LICENSE` |
| `fonts/` (Lato 400/700, Josefin Sans 700, Teilmenge latin) | npm `@fontsource/lato`, `@fontsource/josefin-sans` | 5.3.0 | SIL OFL 1.1, siehe `fonts/LICENSE-*.txt` |
| `rsg-shared/theme.css`, `rsg-shared/portal-link.css` | `das-rsg/rsg-shared`, Ordner `src/` | v0.3.1 | wie `rsg-shared` |

Die RSG-Dateien sind unveränderte Kopien. Änderungswünsche gehen an den Supervisor, der `rsg-shared` pflegt.
Aktualisieren: Version in `package.json` (devDependencies) anheben, `npm install`, Dateien neu kopieren, diese Tabelle anpassen.

PeerJS (nur für die GitHub-Pages-Version) wird nicht hier abgelegt, sondern im Peer-Modus zur Laufzeit von unpkg.com nachgeladen.
Unter dem Schulserver lädt die App PeerJS nie.
