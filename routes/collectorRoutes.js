const express = require("express");
const { admin, db } = require("../firebaseAdmin");
const { authMiddleware, requireCollector } = require("../middleware/authMiddleware");
const { serializeFirestore, validateLocationBody } = require("../utils/validators");

const router = express.Router();

function normalizeCity(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getMillis(value) {
  if (!value) return 0;
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return new Date(value).getTime();
}

router.get("/open-requests", authMiddleware, requireCollector, async (req, res, next) => {
  try {
    const queryCity = normalizeCity(req.query.city);
    const collectorCity = queryCity || normalizeCity(req.collector.cityNormalized || req.collector.serviceCity || req.collector.city);
    
    if (!collectorCity) {
      return res.status(400).json({ error: "City is missing in query or profile." });
    }

    const snapshot = await db
      .collection("requests")
      .where("status", "==", "open")
      .get();

    const requests = snapshot.docs
      .map((doc) => doc.data())
      .filter((request) => normalizeCity(request.cityNormalized || request.city || request.address?.city) === collectorCity)
      .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

    res.json(requests.map(serializeFirestore));
  } catch (error) {
    next(error);
  }
});

router.get("/my-pickups", authMiddleware, requireCollector, async (req, res, next) => {
  try {
    const uid = req.collector ? req.collector.uid : req.user?.uid;
    const snapshot = await db
      .collection("requests")
      .where("collectorId", "==", uid)
      .orderBy("updatedAt", "desc")
      .get();

    res.json(snapshot.docs.map((doc) => serializeFirestore(doc.data())));
  } catch (error) {
    next(error);
  }
});

router.post("/location", authMiddleware, requireCollector, async (req, res, next) => {
  try {
    validateLocationBody(req.body);
    await db.collection("collectors").doc(req.collector.uid).update({
      currentLocation: {
        lat: req.body.lat,
        lng: req.body.lng,
        accuracy: req.body.accuracy ?? null,
        heading: req.body.heading ?? null,
        speed: req.body.speed ?? null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
