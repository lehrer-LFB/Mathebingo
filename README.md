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

- Rein statische Seite: HTML, CSS und JavaScript-Module, kein Build-Schritt.
- Die Geräte verbinden sich direkt über WebRTC mit [PeerJS](https://peerjs.com). Der öffentliche PeerJS-Server vermittelt nur den Verbindungsaufbau, ein Konto ist nicht nötig. Das Gerät des Spielleiters ist der „Server“ und muss während des Spiels **geöffnet bleiben**.
- Lädt ein Spieler die Seite neu oder verliert kurz die Verbindung, kommt er automatisch mit Karte und Markierungen zurück. Dasselbe gilt für den Spielleiter: Das Spiel wird pausiert fortgesetzt.
- Wer erst während der Runde seine Karte abgibt, für den zählen nur die Kugeln ab diesem Moment.

| Datei | Inhalt |
|---|---|
| `index.html`, `css/style.css` | Oberfläche |
| `js/game.js` | Spiellogik (Aufgaben, Kartenprüfung, Bingo-Prüfung) |
| `js/host.js` / `js/player.js` | Spielleiter- und Spieleransicht |
| `js/net.js` | Verbindungsaufbau über PeerJS |
| `test/game.test.mjs` | Tests der Spiellogik (`npm test`, benötigt Node ≥ 20) |

### Lokal ausprobieren
```bash
python3 -m http.server 8000
# Spielleiter: http://localhost:8000/#host
# Spieler (anderes Fenster/Gerät im selben Netz): http://<IP-des-Rechners>:8000/#join
```

### Auf GitHub Pages veröffentlichen
1. Repository auf GitHub anlegen und den Code hochladen (Branch `main`).
2. Unter **Settings → Pages** als Quelle „Deploy from a branch“, Branch `main`, Ordner `/ (root)` wählen.
3. Nach etwa einer Minute läuft das Spiel unter `https://<benutzername>.github.io/<repo>/`.

**Hinweis für Schulnetze:** WebRTC wird von manchen Firewalls eingeschränkt. Kommt keine Verbindung zustande, hilft oft ein anderes Netz, zum Beispiel ein Hotspot. Bleibt das Problem, ließe sich die Verbindung auf einen Dienst wie Firebase umstellen.

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

Eingebundene Bibliotheken von Drittanbietern behalten ihre eigenen Lizenzen. Sie werden zur Laufzeit von einem CDN geladen:
[PeerJS](https://github.com/peers/peerjs) (MIT) und [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
