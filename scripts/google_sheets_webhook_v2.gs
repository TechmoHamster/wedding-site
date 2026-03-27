/**
 * Google Apps Script webhook for wedding forms.
 * Supports:
 * - duplicate_check
 * - append_submission
 * - upsert_submission
 * - formKey routing: rsvp / save_the_date
 *
 * Sheet names expected:
 * - RSVP
 * - Save The Date
 */
function doPost(e) {
  var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  var mode = String(body.mode || "append_submission");
  var formKey = String(body.formKey || "rsvp").toLowerCase();
  var submissionId = String(body.id || "").trim();
  var valuesObj = body.values || {};

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = formKey === "save_the_date" ? "Save The Date" : "RSVP";
  var sheet = spreadsheet.getSheetByName(sheetName);

  // Backward-compatibility for older tab naming.
  if (!sheet && formKey === "save_the_date") {
    sheet = spreadsheet.getSheetByName("Save-the-Date");
  }

  if (!sheet) {
    return jsonResponse({ ok: false, error: "Sheet not found: " + sheetName });
  }

  if (mode === "duplicate_check") {
    var lookup = body.lookup || {};
    var firstName = String(lookup.firstName || "").trim().toLowerCase();
    var lastName = String(lookup.lastName || "").trim().toLowerCase();
    var email = String(lookup.email || "").trim().toLowerCase();

    var rows = sheet.getDataRange().getValues();
    var duplicate = false;

    // In both tabs: A/B/C => First Name / Last Name / Email
    for (var i = 1; i < rows.length; i++) {
      var rowFirst = String(rows[i][0] || "").trim().toLowerCase();
      var rowLast = String(rows[i][1] || "").trim().toLowerCase();
      var rowEmail = String(rows[i][2] || "").trim().toLowerCase();
      if (rowFirst === firstName && rowLast === lastName && rowEmail === email) {
        duplicate = true;
        break;
      }
    }

    return jsonResponse({ ok: true, mode: "duplicate_check", formKey: formKey, duplicate: duplicate });
  }

  var rowData;
  var submissionIdColumnIndex;

  if (formKey === "save_the_date") {
    // Save The Date tab mapping:
    // A firstName, B lastName, C email, D street1, E street2,
    // F city, G postalCode, H state, I country,
    // J likelyAttend (rsvp), K physicalInvite, L submittedAt, M submissionId
    rowData = [
      valuesObj.firstName || "",
      valuesObj.lastName || "",
      valuesObj.email || "",
      valuesObj.street1 || "",
      valuesObj.street2 || "",
      valuesObj.city || "",
      valuesObj.postalCode || "",
      valuesObj.state || "",
      valuesObj.country || "",
      normalizeOption(valuesObj.rsvp, ["Yes", "No", "Maybe"]),
      normalizeOption(valuesObj.physicalInvite, ["Yes", "No"]),
      body.submittedAt || "",
      submissionId
    ];
    submissionIdColumnIndex = 12; // M (0-indexed)
  } else {
    // RSVP tab mapping:
    // A firstName, B lastName, C email, D phone, E smsOptIn,
    // F street1, G street2, H city, I postalCode, J state, K country,
    // L rsvp, M guests, N physicalInvite, O message, P submissionId
    rowData = [
      valuesObj.firstName || "",
      valuesObj.lastName || "",
      valuesObj.email || "",
      valuesObj.phone || "",
      normalizeOption(valuesObj.smsOptIn, ["Yes", "No"]),
      valuesObj.street1 || "",
      valuesObj.street2 || "",
      valuesObj.city || "",
      valuesObj.postalCode || "",
      valuesObj.state || "",
      valuesObj.country || "",
      normalizeOption(valuesObj.rsvp, ["Yes", "No", "Maybe"]),
      valuesObj.guests || "",
      normalizeOption(valuesObj.physicalInvite, ["Yes", "No"]),
      valuesObj.message || "",
      submissionId
    ];
    submissionIdColumnIndex = 15; // P (0-indexed)
  }

  if (mode === "upsert_submission" && submissionId) {
    var all = sheet.getDataRange().getValues();
    var foundRow = -1;

    for (var r = 1; r < all.length; r++) {
      if (String(all[r][submissionIdColumnIndex] || "").trim() === submissionId) {
        foundRow = r + 1;
        break;
      }
    }

    if (foundRow > 0) {
      sheet.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
      return jsonResponse({ ok: true, formKey: formKey, mode: mode, updated: true });
    }
  }

  sheet.appendRow(rowData);
  return jsonResponse({ ok: true, formKey: formKey, mode: mode, updated: false });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeOption(value, allowedOptions) {
  var raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  for (var i = 0; i < allowedOptions.length; i++) {
    if (raw === String(allowedOptions[i]).toLowerCase()) return allowedOptions[i];
  }

  return "";
}
