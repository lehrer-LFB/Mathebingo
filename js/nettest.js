// Verbindungstest: prüft Schritt für Schritt, ob das aktuelle Netzwerk Mathebingo zulässt.
import { $, el, toast } from './ui.js';

const results = [];

function row(id, title) {
  const li = el('li', { class: 'pending', id: `t-${id}` },
    el('span', { class: 'ic', text: '⏳' }),
    el('div', {}, el('strong', { text: title }), el('div', { class: 'small muted detail', text: 'wird geprüft …' })));
  $('#t-list').append(li);
  return li;
}

function setRow(li, ok, detail) {
  li.className = ok === null ? 'skip' : ok ? 'ok' : 'bad';
  li.querySelector('.ic').textContent = ok === null ? '–' : ok ? '✅' : '❌';
  li.querySelector('.detail').textContent = detail;
}

async function step(id, title, fn) {
  const li = row(id, title);
  let r;
  try { r = await fn(); } catch (e) { r = { ok: false, detail: `Fehler: ${e?.message || e}` }; }
  setRow(li, r.ok, r.detail);
  results.push({ id, title, ...r });
  return r.ok;
}

/** Sammelt ICE-Kandidaten und meldet, ob ein Kandidat des gewünschten Typs (srflx/relay) entsteht. */
function probeIce(iceServers, want, timeout = 9000) {
  return new Promise((resolve) => {
    let done = false;
    let pc;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { pc.close(); } catch { /* egal */ }
      resolve({ ok, detail });
    };
    try {
      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: want === 'relay' ? 'relay' : 'all' });
    } catch (e) { finish(false, `Konnte nicht starten: ${e.message}`); return; }
    pc.createDataChannel('test');
    pc.onicecandidate = (e) => {
      if (!e.candidate) { finish(false, 'Keine Antwort vom Server – Port vermutlich gesperrt.'); return; }
      const c = e.candidate.candidate || '';
      if (c.includes(` typ ${want}`)) finish(true, want === 'relay' ? 'Weiterleitung funktioniert.' : 'Server antwortet.');
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish(false, 'Keine Antwort vom Server – Port vermutlich gesperrt.');
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch((e) => finish(false, e.message));
    setTimeout(() => finish(false, `Keine Antwort innerhalb von ${timeout / 1000} s – Port vermutlich gesperrt.`), timeout);
  });
}

function probeSignaling(timeout = 10000) {
  return new Promise((resolve) => {
    let peer;
    let done = false;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { peer.destroy(); } catch { /* egal */ }
      resolve({ ok, detail });
    };
    try { peer = new Peer({ debug: 0 }); } catch (e) { finish(false, e.message); return; }
    peer.on('open', () => finish(true, '0.peerjs.com erreichbar (Port 443).'));
    peer.on('error', (e) => finish(false, `Fehler: ${e.type}`));
    setTimeout(() => finish(false, 'Keine Antwort von 0.peerjs.com – Server vermutlich gesperrt.'), timeout);
  });
}

function verdict(r) {
  if (!r.libs) return ['bad', 'Die Programmbibliotheken konnten nicht geladen werden. Vermutlich sperrt ein Filter unpkg.com oder cdn.jsdelivr.net. Diese Adressen müssten freigegeben werden.'];
  if (!r.rtc) return ['bad', 'Dieser Browser unterstützt kein WebRTC. Bitte einen aktuellen Browser (Chrome, Safari, Firefox, Edge) verwenden.'];
  if (!r.signal) return ['bad', 'Der Vermittlungsserver 0.peerjs.com ist nicht erreichbar. Vermutlich sperrt der Webfilter die Adresse *.peerjs.com. Abhilfe: Freigabe durch die IT oder Umstellung auf einen anderen Dienst.'];
  if (r.stun) {
    return ['warn', 'Direkte Verbindungen sind grundsätzlich möglich (UDP nach außen ist offen). Sie scheitern aber, wenn das WLAN die Geräte voneinander abschottet oder Schüler- und Lehrergeräte in getrennten Netzen sind. Klappt der Beitritt trotzdem nicht, hilft nur ein Weiterleitungsserver (TURN) über Port 443. Tipp: den Test auch auf dem Gerät des Spielleiters ausführen.'];
  }
  return ['bad', 'Das Netzwerk blockiert die Ports, die für direkte Verbindungen (WebRTC) nötig sind – nur normaler Webverkehr (Port 443) kommt durch. Abhilfe: ein Weiterleitungsserver (TURN) über Port 443, z. B. von Metered.ca, oder die Umstellung auf einen reinen Web-Dienst wie Firebase.'];
}

async function runAll() {
  results.length = 0;
  $('#t-list').replaceChildren();
  $('#t-verdict').hidden = true;
  $('#t-run').disabled = true;
  const r = {};
  r.libs = await step('libs', 'Programmbibliotheken geladen', async () => {
    const peer = typeof Peer === 'function';
    const qr = typeof qrcode === 'function';
    return { ok: peer && qr, detail: peer && qr ? 'PeerJS und QR-Code-Generator sind da.' : `Fehlt: ${[!peer && 'PeerJS (unpkg.com)', !qr && 'QR-Code (cdn.jsdelivr.net)'].filter(Boolean).join(', ')}` };
  });
  r.rtc = await step('rtc', 'Browser unterstützt WebRTC', async () => {
    const ok = typeof RTCPeerConnection === 'function';
    return { ok, detail: ok ? 'Ja.' : 'Nein – anderer Browser nötig.' };
  });
  r.signal = r.libs
    ? await step('signal', 'Vermittlungsserver (0.peerjs.com, Port 443)', () => probeSignaling())
    : await step('signal', 'Vermittlungsserver (0.peerjs.com, Port 443)', async () => ({ ok: null, detail: 'übersprungen' }));
  if (r.rtc) {
    r.stun = await step('stun', 'Direkte Verbindungen möglich (STUN über UDP, Port 19302)',
      () => probeIce([{ urls: 'stun:stun.l.google.com:19302' }], 'srflx'));
  }
  const [cls, text] = verdict(r);
  const v = $('#t-verdict');
  v.className = `panel verdict ${cls}`;
  v.replaceChildren(el('strong', { text: cls === 'ok' ? 'Ergebnis: Netzwerk geeignet' : cls === 'warn' ? 'Ergebnis: Direktverbindung möglich, aber ohne Ausweichweg' : 'Ergebnis: Verbindung blockiert' }), el('p', { text }));
  v.hidden = false;
  $('#t-run').disabled = false;
}

async function runCustom() {
  const urls = $('#t-turn-url').value.trim();
  if (!urls) return toast('Bitte eine TURN-Adresse eingeben, z. B. turns:… :443?transport=tcp', 'warn');
  const btn = $('#t-turn-run');
  btn.disabled = true;
  $('#t-turn-result').textContent = 'wird geprüft …';
  const r = await probeIce([{ urls, username: $('#t-turn-user').value, credential: $('#t-turn-pass').value }], 'relay', 12000);
  $('#t-turn-result').textContent = `${r.ok ? '✅' : '❌'} ${r.detail}`;
  results.push({ id: 'custom', title: `Eigener TURN-Server (${urls})`, ...r });
  btn.disabled = false;
}

function report() {
  const lines = [
    `Mathebingo – Verbindungstest ${new Date().toLocaleString('de-DE')}`,
    `Browser: ${navigator.userAgent}`,
    ...results.map((x) => `${x.ok === null ? '–' : x.ok ? 'OK  ' : 'FEHL'}  ${x.title}: ${x.detail}`),
  ];
  const v = $('#t-verdict');
  if (!v.hidden) lines.push('', v.textContent);
  return lines.join('\n');
}

export function startNetTest() {
  $('#t-run').addEventListener('click', runAll);
  $('#t-turn-run').addEventListener('click', runCustom);
  $('#t-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(report()); toast('Ergebnis kopiert'); } catch { $('#t-report').hidden = false; $('#t-report').value = report(); }
  });
  runAll();
}
