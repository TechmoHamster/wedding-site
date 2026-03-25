# Wedding Address + RSVP Dashboard

Handcrafted mountain/forest themed wedding guest form with:
- Dynamic public form (editable from admin dashboard)
- Admin login and form builder
- Submission viewer with time filters
- CSV export by range (`all`, `6h`, `24h`, `7d`)
- Google Apps Script webhook forwarding
- Google Form forwarding via `formResponse` + entry mapping

## Run

```bash
cd "/Users/zdjpro/Documents/Wedding Website/Addresses"
ADMIN_PASSWORD="your-secure-password" npm start
```

- Public form: `http://localhost:3000/`
- Admin dashboard: `http://localhost:3000/admin`

If `ADMIN_PASSWORD` is not set, the default password is `change-me-now`.

## Admin Features

In `/admin`, you can:
- Edit hero text and button/success labels
- Add/remove/reorder fields
- Change field type, required state, width, default, options
- Set conditional visibility (show field only when another field matches values)
- View submissions with range filters
- Export CSV by selected range

## Google Integrations

### Option 1: Google Sheets (Apps Script webhook)

1. Create a Google Sheet.
2. Open Extensions -> Apps Script.
3. Add a script similar to:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

  if (body.mode === "duplicate_check") {
    var lookup = body.lookup || {};
    var firstName = String(lookup.firstName || "").trim().toLowerCase();
    var lastName = String(lookup.lastName || "").trim().toLowerCase();
    var email = String(lookup.email || "").trim().toLowerCase();

    var values = sheet.getDataRange().getValues();
    var duplicate = false;

    // Assumes columns A/B/C are First Name / Last Name / Email.
    for (var i = 1; i < values.length; i++) {
      var rowFirst = String(values[i][0] || "").trim().toLowerCase();
      var rowLast = String(values[i][1] || "").trim().toLowerCase();
      var rowEmail = String(values[i][2] || "").trim().toLowerCase();

      if (rowFirst === firstName && rowLast === lastName && rowEmail === email) {
        duplicate = true;
        break;
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, mode: "duplicate_check", duplicate: duplicate }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var valuesObj = body.values || {};
  sheet.appendRow([
    valuesObj.firstName || "",
    valuesObj.lastName || "",
    valuesObj.email || "",
    valuesObj.phone || "",
    valuesObj.smsOptIn || "",
    valuesObj.street1 || "",
    valuesObj.street2 || "",
    valuesObj.city || "",
    valuesObj.postalCode || "",
    valuesObj.state || "",
    valuesObj.country || "",
    valuesObj.rsvp || "",
    valuesObj.guests || "",
    valuesObj.message || "",
    valuesObj.dietaryNotes || ""
  ]);

  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. Deploy -> New deployment -> Web app.
5. Set access to allow requests.
6. Copy the Web App URL into Admin -> Integrations -> `Google Sheets Webhook URL`.

Optional secret verification in Apps Script (recommended):

```javascript
function doPost(e) {
  var expected = "YOUR_SECRET_HERE";
  var incoming = e && e.parameter ? e.parameter.secret : "";
  // If you prefer header-based validation, parse from e.postData or switch to Web App + proxy.
  if (expected && incoming !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Unauthorized" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ... normal appendRow logic
}
```

If you use a secret, keep the same value in Admin -> Integrations -> `Optional Webhook Secret`.

### Option 2: Google Form

1. Create a Google Form and inspect its `formResponse` URL.
2. Find each field entry id like `entry.123456789`.
3. In Admin -> Integrations:
   - Enable Google Form forwarding
   - Add the `formResponse` URL
   - Add JSON map from form field IDs to Google entry IDs, for example:

```json
{
  "firstName": "entry.111111",
  "lastName": "entry.222222",
  "email": "entry.333333",
  "rsvp": "entry.444444"
}
```

## Data Storage

- Settings: `data/settings.json`
- Submissions: `data/submissions.json`

This is file-based storage for handcrafted/self-hosted workflow simplicity.


### Integration Health

In Admin -> Integrations, use **Test Integrations + Retry Queue** to:
- Run a live connectivity check for Google Sheets and Google Form endpoints
- Process pending retry queue items for previously failed forwards
