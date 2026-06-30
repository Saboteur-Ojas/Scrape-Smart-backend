const VALID_STATUSES = new Set(["open", "accepted", "completed", "cancelled"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isLatLng(value) {
  return value
    && typeof value === "object"
    && typeof value.lat === "number"
    && value.lat >= -90
    && value.lat <= 90
    && typeof value.lng === "number"
    && value.lng >= -180
    && value.lng <= 180;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    const error = new Error(`Missing required field(s): ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function validateCreateRequestBody(body) {
  requireFields(body, [
    "city",
    "pickupAddress",
    "scrapCategory",
    "quantity",
    "description",
    "imageUrl",
    "imagePublicId",
  ]);

  if (body.location != null && !isLatLng(body.location)) {
    const error = new Error("location must be { lat, lng } with valid coordinates.");
    error.status = 400;
    throw error;
  }

  for (const field of ["city", "pickupAddress", "scrapCategory", "quantity", "description", "imageUrl", "imagePublicId"]) {
    if (!isNonEmptyString(body[field])) {
      const error = new Error(`${field} must be a non-empty string.`);
      error.status = 400;
      throw error;
    }
  }
}

function validateLocationBody(body) {
  if (!isLatLng(body)) {
    const error = new Error("Body must be { lat, lng } with valid coordinates.");
    error.status = 400;
    throw error;
  }

  for (const field of ["accuracy", "heading", "speed"]) {
    if (body[field] != null && typeof body[field] !== "number") {
      const error = new Error(`${field} must be a number when provided.`);
      error.status = 400;
      throw error;
    }
  }
}

function serializeFirestore(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestore);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestore(item)]));
  }
  return value;
}

function assertValidStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    const error = new Error("Invalid request status.");
    error.status = 400;
    throw error;
  }
}

module.exports = {
  assertValidStatus,
  serializeFirestore,
  validateCreateRequestBody,
  validateLocationBody,
};
