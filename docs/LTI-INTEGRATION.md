# LTI-1.3-Integration des Editors — Plan (überarbeitet)

**Stand:** 2026-07-08, verifiziert gegen die OpenAPI-Spec der Staging
(`https://repository.staging.openeduhub.net/edu-sharing/rest/openapi.json`,
25 LTI-Endpunkte). **Status: Konzept — nichts davon ist umgesetzt.**

## 1. Die entscheidende Erkenntnis: die Richtung dreht sich

Der ursprüngliche Plan (Editor als LTI-Tool direkt in einem LMS wie Moodle
registrieren) ist der **umständlichere** Weg. edu-sharing ist selbst voll
LTI-1.3-fähig — **in beide Richtungen**:

| API | Rolle von edu-sharing | Zweck |
|---|---|---|
| `/lti/v13/*` | **Tool** | edu-sharing wird aus einem LMS heraus gelauncht (Rendering, Deep Linking, Dynamic Registration) |
| `/ltiplatform/v13/*` | **Platform** | edu-sharing launcht **externe Tools — insbesondere Editoren** (ONLYOFFICE-/Serlo-Editor-Muster) |

Der richtige Schnitt ist also: **unser Editor wird als LTI-Tool bei edu-sharing
(der Platform) registriert** — nicht bei jedem LMS einzeln. Die LMS-Anbindung
gibt es dann **transitiv geschenkt**: LMS ↔ edu-sharing läuft über `/lti/v13`
(bestehende edu-sharing-Funktionalität), edu-sharing ↔ Editor über
`/ltiplatform/v13`. Eine Registrierung, alle angeschlossenen Umgebungen.

## 2. Verifizierte Bausteine der edu-sharing-LTI-Platform

Aus der Spec (Staging, 07/2026):

- **OIDC-Kern:** `GET /ltiplatform/v13/openid-configuration`, `GET …/auth`
  (Login-Authentication-Response), `GET …/token` (Auth-Token-Endpoint),
  `GET /lti/v13/jwks` (Platform-JWKS zum Validieren der Launch-JWTs).
- **Tool-Registrierung:** komfortabel per **LTI Dynamic Registration**
  (`…/start-dynamic-registration` + `…/openid-registration`) oder manuell
  (`POST …/manual-registration`, Schema `ManualRegistrationData`: `toolUrl`,
  `keysetUrl`, `loginInitiationUrl`, `redirectionUrls`, `targetLinkUri`,
  `customParameters`, Logo/Name).
- **Resource-Link-Launch:** `GET …/generateLoginInitiationFormResourceLink
  ?nodeId=…&editMode=true&launchPresentation=iframe|window` — startet den
  Launch für einen Knoten. `editMode=true` legt den `changeContentUrl`-Claim
  in die Launch-Message (sonst nur Lese-`contentUrl`).
- **Content-Zugriff (der Clou):** `GET|POST /ltiplatform/v13/content?jwt=…` —
  liest/schreibt den **Datei-Content** eines Knotens. Der JWT trägt die Claims
  `appId`, `nodeId`, `user` (aus dem Launch) und ist **„Must be signed by
  tool"** — d. h. **unser Server signiert ihn selbst** mit seinem registrierten
  Schlüssel. Konsequenz: Der Server kann **zeitversetzt** (Debounce!, Retry,
  Save-on-Disconnect) im Namen des gelaunchten Nutzers schreiben — ohne
  Passwort, ohne Ticket, ohne Service-Account. POST unterstützt
  `versionComment` (leer = keine neue Version) und `mimetype`.
- **io → ResourceLink:** `POST …/convert2resourcelink?nodeId=…&appId=…`
  verdrahtet einen bestehenden Knoten manuell mit einem Tool.
- **Deep Linking:** `POST …/deeplinking-response` (Editor könnte als
  „neuen kompendialen Text anlegen"-Tool auftreten).

Damit ist **Option B (echte Nutzer) nativ eingebaut**: Identität kommt aus dem
Launch-JWT, die Rechteprüfung macht edu-sharing am Content-Endpunkt, die
Attribution stimmt. Kein AppAuth-Umweg für den Content-Fall nötig.

## 3. Der eine Konfliktpunkt: Property vs. Datei-Content

Die LTI-Content-Endpunkte bedienen **Datei-Content** (multipart, MIME-Type,
Versionierung). Unser Editor schreibt das Kompendium aber in ein **Property**
(`ccm:oeh_collection_compendium_text`) — und `ccm:map`-Sammlungen haben gar
keinen Datei-Content. Drei Wege:

| Weg | Beschreibung | Bewertung |
|---|---|---|
| **(a) Content-basiert** | Markdown als Datei-Content eines `ccm:io` („kompendialer Text"-Objekt, `text/markdown`) | Funktioniert **komplett mit LTI-Bordmitteln** (inkl. Versionierung!). Aber: anderes Speicherziel, für Sammlungen ungeeignet |
| **(b) Hybrid** ⭐ | LTI liefert Launch/Identität/Embedding; Property-Writes weiter über REST — Brücke: Launch-`user` → **AppAuth/Trusted-App-Ticket** → unser bestehender `{ticket}`-Login | Empfohlener Start: nutzt beide vorhandenen Mechanismen, Editor-Speicherlogik bleibt unverändert |
| **(c) Platform-Erweiterung** | edu-sharing-Team erweitert den content-Endpunkt um Property-Zugriff (z. B. `?property=…`) | Sauberster Langfristweg — deckt sich mit dem ohnehin geplanten Wunsch, das Compendium-Property ins MDS aufzunehmen; Abhängigkeit vom edu-sharing-Release |

Pragmatische Linie: **(b) als Startpunkt**, (c) als Wunsch ans edu-sharing-Team
adressieren, (a) als Option falls kompendiale Texte künftig als eigene
io-Objekte modelliert werden.

## 4. Was am Editor-Stack zu bauen ist

Die Web Component bleibt **unverändert** (Kollaboration, Presence, Save-Timing,
Tagging, i18n — nichts hängt an der Auth-Quelle). Neu ist ein LTI-Tool-Layer im
Server:

1. **Tool-Endpunkte:** OIDC-Login-Initiation, Launch-Endpoint (id_token
   validieren gegen `/lti/v13/jwks`: iss/aud/nonce/deployment), eigenes
   Keypair + `/.well-known/jwks.json`, Dynamic-Registration-Endpoint.
2. **Session-Brücke:** validierter Launch → opake Session im **bestehenden**
   Session-Store; statt Basic-Header hält die Session den LTI-Kontext
   (`appId`, `nodeId`, `user`) bzw. das AppAuth-Ticket (Weg b). Der
   Launch-Handler rendert eine schlanke Embed-Seite mit
   `<md-collab-editor document-name=… token=… user-name=… lang=…>` —
   Name und Locale direkt aus den JWT-Claims.
3. **Persistenz-Anbindung:** `persistDocument` bekommt neben dem
   Basic/Ticket-Weg den LTI-Weg: Weg (b) = unverändert REST mit Ticket;
   Weg (a) = Tool-signierter JWT → `POST /ltiplatform/v13/content`.
   Read-Back-Reflex bleibt in jedem Fall Pflicht.
4. **Konfiguration:** `ALLOWED_ORIGINS`/`frame-ancestors` um die
   edu-sharing-Origin erweitern (reine Config, existiert schon);
   `launchPresentation=iframe` wird damit sauber unterstützt — das
   Third-Party-Cookie-Drama des alten Plans entfällt weitgehend, weil die
   Kette edu-sharing-kontrolliert ist und unsere Sessions cookielos sind.

## 5. Aufwandsschätzung (überarbeitet)

| WP | Inhalt | Aufwand |
|---|---|---|
| 1 | LTI-Tool-Core (OIDC-Init, Launch-Validierung, Keypair/JWKS, Dynamic Registration) | 3–4 PT |
| 2 | Session-Brücke + Embed-Seite | 1–2 PT |
| 3 | Persistenz: Weg (b) AppAuth-Ticket **inkl. Staging-Verifikation** | 2–3 PT |
| — | (alternativ Weg (a) content-Endpunkt für io-Knoten) | (1–2 PT) |
| 4 | Registrierung am Staging + E2E (echter Launch, editMode, iframe/window, `testToken`-Endpoint für lokale Tests) | 2–3 PT |
| 5 | Deep Linking („neuen kompendialen Text anlegen") — optional | 2–3 PT |
| 6 | Doku | 1 PT |

**Gesamt: ~1,5–2,5 Wochen** — weniger als der alte LMS-direkt-Plan, bei
größerer Reichweite (alle an edu-sharing hängenden Umgebungen) und nativer
Nutzer-Attribution.

## 6. Umsetzen & Testen OHNE Admin-Zugriff (verifiziert 07/2026)

**~90 % der Arbeit braucht keinerlei Systemzugriff.** Live-Probe am Staging:
`openid-configuration` und die Platform-JWKS sind **öffentlich** (200 anonym)
und liefern alles Nötige — Issuer, alle Endpunkt-URLs, `RS256`,
`private_key_jwt` am Token-Endpoint, `claims_supported: sub, given_name,
family_name, email` (Nutzeridentität im Launch damit bestätigt), Messages
`LtiResourceLinkRequest` + `LtiDeepLinkingRequest` (edu-sharing 11.0). Nur die
Registrierungsverwaltung ist zugriffsbeschränkt (`GET …/tools` → 401 anonym).

Vier Teststufen:

1. **Lokal, 0 % Admin — Platform-Emulator:** Der komplette Tool-Core wird
   gegen einen kleinen Mock getestet (id_tokens mit Testschlüssel signieren,
   JWKS servieren, content GET/POST annehmen) — exakt das bewährte Muster
   unserer Testsuite (Mock-edu-sharing in `api-auth.test.mjs`, gestubbtes Repo
   in `keyword-lifecycle.test.mjs`). Ergebnis: Launch→Edit→Save als E2E in CI.
   Die exakten Custom-Claims liest man aus dem **edu-sharing-Quellcode**
   (Open Source) ab statt vom Live-System.
2. **Spec-Konformität, 0 % Admin:** Gegen die öffentliche **1EdTech LTI
   Reference Implementation** (lti-ri.imsglobal.org, freie Registrierung)
   und/oder die **Moodle-Sandbox** (sandbox.moodledemo.net — öffentlicher
   Admin-Zugang, stündlich zurückgesetzt) echte Launches einer unabhängigen
   Implementierung fahren.
3. **Eigene edu-sharing-Instanz, 0 % Staging-Admin:** edu-sharing Community
   Edition per Docker lokal aufsetzen — dort sind wir Admin und testen die
   **komplette echte Kette** (manual-registration, Launch aus der UI,
   content-Endpunkte, AppAuth). Schwergewichtig (Alfresco-Stack), aber der
   vollwertigste Test ohne Staging-Rechte.
4. **Staging — einmalig Admin nötig, delegierbar:** Die Tool-Registrierung ist
   EIN Vorgang (ein `manual-registration`-Call bzw. ein Dynamic-Registration-
   Token). Vorgehen: wir liefern dem Admin ein fertiges **Registrierungspaket**
   (JSON: `keysetUrl`, `loginInitiationUrl`, `redirectionUrls`,
   `targetLinkUri`, Logo/Name) → ~5 Minuten Admin-Zeit. Gleiches gilt für die
   Trusted-App (Weg b). Erst der finale Abnahmetest (Launch aus der echten
   Staging-UI) braucht diese Registrierung.

## 7. Offene Verifikationspunkte (vor Umsetzungsbeginn)

1. **Exakte Custom-Claim-Namen** des ResourceLink-Launch (`contentUrl`/
   `changeContentUrl`/`user`/`appId` — die OpenAPI-Spec dokumentiert die
   Claims nicht; per Test-Launch am Staging oder edu-sharing-Doku klären).
2. **AppAuth am Staging** (Weg b): Trusted-App registrieren, Ticket für einen
   Launch-User beziehen, `{ticket}`-Login durchspielen (~0,5 PT).
3. **Signatur-Details** des Tool-JWT für die content-Endpunkte (Algorithmus,
   erwartete Header) — `PUT /ltiplatform/v13/testToken` hilft beim lokalen
   Testen.
4. Rückfrage ans edu-sharing-Team zu Weg (c): Property-Zugriff über die
   LTI-Content-Schiene bzw. MDS-Aufnahme des Compendium-Properties.
