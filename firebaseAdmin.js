const admin = require("firebase-admin");
const { AsyncLocalStorage } = require("async_hooks");

const tokenStorage = new AsyncLocalStorage();
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "scrapsmart-762df";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function getHeaders() {
  const token = tokenStorage.getStore();
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function decodeToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
    return payload;
  } catch (e) {
    return null;
  }
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return parseFloat(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if (value.mapValue !== undefined) {
    const obj = {};
    const fields = value.mapValue.fields || {};
    for (const key of Object.keys(fields)) {
      obj[key] = fromFirestoreValue(fields[key]);
    }
    return obj;
  }
  if (value.nullValue !== undefined) return null;
  return value;
}

function fromFirestoreFields(fields) {
  const obj = {};
  if (!fields) return obj;
  for (const key of Object.keys(fields)) {
    obj[key] = fromFirestoreValue(fields[key]);
  }
  return obj;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) {
        fields[key] = toFirestoreValue(value[key]);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(data) {
  const fields = {};
  if (!data) return fields;
  for (const key of Object.keys(data)) {
    if (data[key] !== undefined) {
      fields[key] = toFirestoreValue(data[key]);
    }
  }
  return fields;
}

class DocumentSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = data !== undefined && data !== null;
  }
  data() {
    return this._data;
  }
}

class CollectionReference {
  constructor(name) {
    this.name = name;
  }
  doc(id) {
    if (!id) {
      id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    return new DocumentReference(this.name, id);
  }
  where(field, op, value) {
    return new Query(this.name, [[field, op, value]]);
  }
}

class Query {
  constructor(collectionName, filters = [], orderByField = null, orderDirection = 'asc') {
    this.collectionName = collectionName;
    this.filters = filters;
    this.orderByField = orderByField;
    this.orderDirection = orderDirection;
  }
  where(field, op, value) {
    return new Query(this.collectionName, [...this.filters, [field, op, value]], this.orderByField, this.orderDirection);
  }
  orderBy(field, direction = 'asc') {
    return new Query(this.collectionName, this.filters, field, direction);
  }
  async get() {
    const fieldFilters = this.filters.map(([field, op, value]) => {
      let restOp = "EQUAL";
      if (op === "==") restOp = "EQUAL";
      return {
        fieldFilter: {
          field: { fieldPath: field },
          op: restOp,
          value: toFirestoreValue(value),
        }
      };
    });

    const whereClause = fieldFilters.length === 0 ? undefined : (
      fieldFilters.length === 1 ? fieldFilters[0] : {
        compositeFilter: {
          op: "AND",
          filters: fieldFilters,
        }
      }
    );

    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: this.collectionName }],
        where: whereClause,
      }
    };

    const response = await fetch(`${BASE_URL}:runQuery`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(queryBody),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`runQuery failed with ${response.status}: ${text}`);
      return {
        docs: [],
        empty: true,
        forEach(cb) {}
      };
    }

    const rawResults = await response.json();
    const results = (Array.isArray(rawResults) ? rawResults : [])
      .filter(item => item.document)
      .map(item => {
        const doc = item.document;
        const id = doc.name.split("/").pop();
        const data = fromFirestoreFields(doc.fields);
        return new DocumentSnapshot(id, data);
      });

    if (this.orderByField) {
      results.sort((a, b) => {
        const valA = a.data()[this.orderByField];
        const valB = b.data()[this.orderByField];
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;
        if (valA < valB) return this.orderDirection.toLowerCase() === "desc" ? 1 : -1;
        if (valA > valB) return this.orderDirection.toLowerCase() === "desc" ? -1 : 1;
        return 0;
      });
    }

    return {
      docs: results,
      empty: results.length === 0,
      forEach(cb) {
        results.forEach(cb);
      }
    };
  }
}

class DocumentReference {
  constructor(collectionName, id) {
    this.collectionName = collectionName;
    this.id = id;
  }
  async get() {
    const response = await fetch(`${BASE_URL}/${this.collectionName}/${this.id}`, {
      headers: getHeaders(),
    });
    if (response.status === 404) {
      return new DocumentSnapshot(this.id, null);
    }
    if (!response.ok) {
      const text = await response.text();
      console.error(`Get doc failed: ${text}`);
      return new DocumentSnapshot(this.id, null);
    }
    const doc = await response.json();
    const data = fromFirestoreFields(doc.fields);
    return new DocumentSnapshot(this.id, data);
  }
  async set(data, options) {
    const fields = toFirestoreFields(data);
    let url = `${BASE_URL}/${this.collectionName}/${this.id}`;
    
    if (options && options.merge) {
      const keys = Object.keys(data);
      const updateMaskQuery = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
      url = `${url}?${updateMaskQuery}`;
    }

    const response = await fetch(url, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Firestore set failed: ${text}`);
    }
  }
  async update(data) {
    const fields = toFirestoreFields(data);
    const keys = Object.keys(data);
    const updateMaskQuery = keys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    const url = `${BASE_URL}/${this.collectionName}/${this.id}?${updateMaskQuery}`;
    
    const response = await fetch(url, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Firestore update failed: ${text}`);
    }
  }
}

class RestFirestore {
  collection(name) {
    return new CollectionReference(name);
  }
  async runTransaction(cb) {
    const transaction = {
      get: async (ref) => ref.get(),
      set: (ref, data) => ref.set(data),
      update: (ref, data) => ref.update(data),
    };
    return cb(transaction);
  }
}

let activeDb;
let activeAdmin;

const hasCert = process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;

if (hasCert) {
  console.log("Initializing production Firebase Admin SDK with credentials.");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  }
  activeDb = admin.firestore();
  activeAdmin = admin;
} else {
  console.log("Using local REST Firestore client fallback.");
  activeDb = new RestFirestore();
  activeAdmin = {
    auth: () => ({
      verifyIdToken: async (token) => {
        const decoded = decodeToken(token);
        if (!decoded || !decoded.user_id) {
          throw new Error("Invalid token format");
        }
        return {
          uid: decoded.user_id,
          email: decoded.email,
          ...decoded
        };
      }
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => new Date().toISOString(),
      }
    }
  };
}

module.exports = { admin: activeAdmin, db: activeDb, tokenStorage };
