# Mathebingo

Bingo mit Rechenaufgaben für die Klasse. Jede „Kugel“ ist eine Rechnung wie **7 × 45 − 280**. Wer das Ergebnis auf seiner Karte findet, markiert es. Wer zuerst eine volle Reihe hat, ruft **BINGO!**

Es gibt zwei Versionen:
- die **WebApp** (`index.html`) für GitHub Pages, mit Mehrspieler-Modus über Handy, Tablet oder Laptop
- das ursprüngliche **Desktop-Programm** (`mathe_bingo_gui.py`, Python/Tkinter)

## Spielregeln (WebApp)

1. Der **Spielleiter** öffnet die Seite und wählt „Spiel leiten“. Er bekommt einen Raumcode und einen QR-Code (ideal für den Beamer).
2. Die **Spieler** scannen den QR-Code oder geben den Code unter „Mitspielen“ ein und wählen einen **Spitznamen**.
3. Der Spielleiter wählt in der Lobby den **Aufgabentyp** (siehe unten).
4. Jeder trägt **eigene Glückszahlen** in seine leere Karte ein: 24 Zahlen auf der 5×5-Karte mit **Freifeld** in der Mitte, bei „bis 20“ nur 9 Zahlen auf einer 3×3-Karte. Wer mag, lässt den Rest zufällig auffüllen.
5. Der Spielleiter stellt den **Abstand zwischen zwei Kugeln (10–120 s)** ein und startet die Runde. Die Rechnung erscheint groß am Beamer und auf jedem Spielergerät.
6. Die Spieler rechnen und tippen passende Felder auf ihrer Karte an.
7. Bei einer vollen **Zeile, Spalte oder Diagonale** drückt man **BINGO!** Die App prüft automatisch, ob alle markierten Zahlen wirklich gezogen wurden. Der Spielleiter sieht jede Meldung mit Spitznamen. Es kann mehrere Gewinner geben (Platz 1, 2, …).
8. Am **Rundenende** sehen alle die Liste der Rechnungen mit Lösungen. Auf der eigenen Karte wird markiert, was richtig, falsch oder übersehen war.

Der Spielleiter kann jederzeit pausieren, sofort die nächste Kugel ziehen und den Abstand ändern. Rechts gibt es ein einklappbares Kontrollraster aller Zahlen, das nur für ihn gedacht ist.

### Aufgabentypen

Der Spielleiter wählt den Typ vor jeder Runde. Ändert er ihn, nachdem schon Karten abgegeben wurden, müssen alle ihre Karte neu ausfüllen.

| Typ | Beispiel | Zahlen auf der Karte | Karte |
|---|---|---|---|
| Mal · Kleines Einmaleins (a, b von 1 bis 10) | 7 × 8 + 12 | 1–100 | 5×5 mit Freifeld |
| Mal · Mittel (a von 1 bis 10, b von 1 bis 100) | 7 × 45 − 280 | 1–100 | 5×5 mit Freifeld |
| Mal · Schwer (a, b von 1 bis 100) | 23 × 58 − 1297 | 1–100 | 5×5 mit Freifeld |
| Plus bis 20 | 9 + 6 | 2–20 | 3×3 ohne Freifeld |
| Plus/Minus bis 20 | 13 − 5 | 1–20 | 3×3 ohne Freifeld |
| Plus bis 100 | 47 + 25 | 2–100 | 5×5 mit Freifeld |
| Plus/Minus bis 100 | 72 − 38 | 1–100 | 5×5 mit Freifeld |

Jedes Ergebnis kommt pro Runde nur einmal vor. Sind alle möglichen Ergebnisse gezogen, ist die Runde vorbei.

### So entstehen die Rechnungen
Zuerst wird zufällig ein Ergebnis gewählt, das in dieser Runde noch nicht vorkam. Dann wird eine passende Rechnung gebaut:

- **Mal-Aufgaben:** a und b werden im Bereich der Stufe gewürfelt.
  - Ist a·b kleiner als 100, lautet die Rechnung **a × b + e**.
  - Sonst lautet sie **a × b − e**.
  - e wird so ausgerechnet, dass genau das Ergebnis herauskommt. Es muss dieselben Grenzen einhalten wie im ursprünglichen Python-Programm. Passt es nicht, werden a und b neu gewürfelt.
- **Plus-Aufgaben:** Ein Summand wird zufällig gewählt, der andere ergibt sich, z. B. 9 + 6 = 15.
- **Minus-Aufgaben:** Die erste Zahl wird zwischen Ergebnis und Zahlenraumgrenze gewählt, z. B. 13 − 5 = 8. Ist Minus erlaubt, kommen Plus und Minus etwa gleich oft vor. Keine Zahl der Rechnung ist größer als der Zahlenraum.

## Technik

Mathebingo läuft in zwei Varianten. Die Spiellogik ist dieselbe, nur die Netzwerkschicht (`js/net.js`) unterscheidet sich:

| | Schulserver (Weblehrerzimmer) | GitHub Pages |
|---|---|---|
| Adresse | `https://webapps.das-rsg.de/mathebingo/` | `https://lehrer-lfb.github.io/Mathebingo/` |
| Verbindung | WebSocket über den eigenen Server (HTTPS, Port 443) | PeerJS/WebRTC direkt zwischen den Geräten |
| Spiel leiten | nur angemeldete Lehrkräfte (Login des Weblehrerzimmers) | alle |
| Schul-WLAN | funktioniert auch mit Client-Isolation | scheitert oft (siehe Verbindungstest `#test`) |

Die App erkennt die Variante selbst: Antwortet `./api/me`, läuft ein Relay-Server, sonst wird PeerJS von unpkg.com nachgeladen.

- Statische Seite (HTML, CSS, JavaScript-Module) ohne Build-Schritt. Alle Fremddateien liegen in `vendor/` (keine CDNs, siehe `vendor/README.md`).
- Der Spielzustand liegt beim Gerät der Lehrkraft, das **geöffnet bleiben** muss. Der Server leitet nur weiter.
- Unterbrechungen (Display-Sperre am iPad, Neuladen) werden abgefangen: Mit dem Wiederverbindungs-Token in `sessionStorage` kommt man mit Platz und Karte zurück, die Lehrkraft mit ihrem Raum. Beides geht innerhalb von 10 Minuten.
- Wer erst während der Runde seine Karte abgibt, für den zählen nur die Kugeln ab diesem Moment.
- Doppelte Spitznamen bekommen eine Ziffer angehängt. Die Lehrkraft kann Spieler:innen entfernen und den Raum für neue Beitritte sperren.

| Datei | Inhalt |
|---|---|
| `index.html`, `css/style.css` | Oberfläche (RSG-Design aus `vendor/rsg-shared/`) |
| `js/game.js` | Spiellogik (Aufgaben, Kartenprüfung, Bingo-Prüfung) |
| `js/host.js` / `js/player.js` | Spielleiter- und Spieleransicht |
| `js/net.js` | Transport-Schnittstelle: Relay (WebSocket) oder PeerJS |
| `server/` | Node-Dienst: liefert die Seite unter `BASE_PATH` aus, WebSocket-Relay, Login-Prüfung |
| `test/` | Unit-Tests: Spiellogik, Login, Relay (`npm test`) |
| `e2e/` | Playwright-Tests in iPad-Profilen (`npm run e2e`) |

### Server (Typ B im Weblehrerzimmer)

Ein kleiner Node-Dienst, einzige Abhängigkeiten sind `ws` und `@auth/core`. Er liefert unter `BASE_PATH` (Standard `/mathebingo`) aus:

| Pfad | Zweck |
|---|---|
| `/mathebingo/` | die App (nur `index.html`, `css/`, `js/`, `vendor/`) |
| `/mathebingo/ws` | WebSocket-Relay; `?role=host` nur mit Lehrkraft-Login |
| `/mathebingo/api/me` | `{ relay, name, isTeacher, testSystem }` |
| `/mathebingo/health` | Healthcheck, antwortet `ok` |

Konfiguration nur über Umgebungsvariablen, siehe `.env.example`: `PORT`, `BASE_PATH`, `AUTH_SECRET`, `ALLOWED_ORIGINS` und `TESTSYSTEM`.

Grenzen, alle in `server/relay.mjs`:
- höchstens 50 Räume, je Raum 40 Spieler:innen
- Nachrichten: 4 KB und 20 pro Sekunde je Spieler:in
- Raumcodes: höchstens 5 falsche pro Verbindung, 120 Fehlversuche pro Minute und IP
- Räume werden nach 3 h ohne Aktivität bzw. spätestens 8 h nach dem Eröffnen aufgeräumt

Alle Daten liegen nur im Arbeitsspeicher. Logs enthalten keine Spitznamen, Inhalte oder IP-Adressen.

```bash
npm ci
AUTH_SECRET=… ALLOWED_ORIGINS=http://localhost:3005 npm start   # http://localhost:3005/mathebingo/
npm test                      # Unit-Tests
npx playwright install webkit && npm run e2e
```

Docker-Probelauf (Image `run`-Stufe, Port 3000, User `node`):
```bash
docker build -t mathebingo .
docker run --rm -p 3005:3000 -e AUTH_SECRET=… -e ALLOWED_ORIGINS=http://localhost:3005 -e TESTSYSTEM=true mathebingo
E2E_EXTERNAL=1 npm run e2e    # Playwright gegen den laufenden Container
```
Integration und Deployment übernimmt der Supervisor im Portal-Repo `das-rsg/weblehrerzimmer`.

### GitHub Pages
Unter **Settings → Pages** als Quelle Branch `main` und Ordner `/ (root)` wählen. Ohne eigenen Server spielt die App über PeerJS. Für einen kurzen Test reicht `python3 -m http.server 8000`, dann `http://localhost:8000/#host` öffnen.

**Hinweis für Schulnetze:** WebRTC scheitert oft an Client-Isolation im WLAN, und die öffentlichen PeerJS-Weiterleitungsserver gibt es nicht mehr. Im Schulnetz deshalb die Variante über den Schulserver verwenden.

## Desktop-Version (alt)

```bash
python mathe_bingo_gui.py
```
Sie erzeugt die Rechnungen mit demselben Algorithmus, auf Wunsch per Timer, und zeigt die gezogenen Ergebnisse in einem 10×10-Raster. `alpha 0.1` und `Rechnungsgenerator.py` sind frühe Versionen des Aufgabenkerns.

## Lizenz

© 2026 Daniel von Laufenberg – **Mathebingo** steht unter der Lizenz
[Creative Commons Namensnennung – Nicht kommerziell – Weitergabe unter gleichen Bedingungen 4.0 International (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.de).
Der vollständige Lizenztext steht in [`LICENSE`](LICENSE).

- ✅ **Erlaubt:** Schulen, Lehrkräfte, Hochschulen und andere Bildungseinrichtungen dürfen das Spiel frei nutzen, kopieren, weitergeben und anpassen, auch im Unterricht und auf eigenen Servern.
- 📝 **Bedingungen:** Den Urheber und die Lizenz nennen. Veränderte Versionen müssen unter derselben Lizenz weitergegeben werden.
- 🚫 **Nicht erlaubt:** jede kommerzielle Nutzung, zum Beispiel Verkauf, Einbau in kostenpflichtige Produkte oder Plattformen oder Nutzung durch gewinnorientierte Anbieter. Wer das möchte, braucht eine gesonderte Erlaubnis des Urhebers.

Eingebundene Bibliotheken von Drittanbietern behalten ihre eigenen Lizenzen: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) sowie die Schriften Lato und Josefin Sans (SIL OFL 1.1) liegen in `vendor/`. [PeerJS](https://github.com/peers/peerjs) (MIT) lädt nur die GitHub-Pages-Variante von unpkg.com nach. Für den Server gilt: [ws](https://github.com/websockets/ws) (MIT), [@auth/core](https://github.com/nextauthjs/next-auth) (ISC).
