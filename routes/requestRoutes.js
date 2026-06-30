const express = require("express");
const { admin, db } = require("../firebaseAdmin");
const {
  authMiddleware,
  loadCollectorProfile,
  loadUserProfile,
  requireCollector,
  requireUser,
} = require("../middleware/authMiddleware");
const { serializeFirestore, validateCreateRequestBody } = require("../utils/validators");

const router = express.Router();
const requests = db.collection("requests");

function requestDoc(id) {
  return requests.doc(id);
}

function normalizeCity(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

router.post("/", authMiddleware, requireUser, async (req, res, next) => {
  try {
    validateCreateRequestBody(req.body);

    const ref = requests.doc();
    const now = serverTimestamp();
    const city = req.body.city.trim();
    const location = req.body.location || null;
    const address = req.body.address || {
      line: req.body.pickupAddress.split(",")[0]?.trim() || req.body.pickupAddress.trim(),
      area: req.body.pickupAddress.split(",")[1]?.trim() || "",
      city,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
    };
    const data = {
      requestId: ref.id,
      userId: req.user ? req.user.uid : "prototype_user",
      userName: req.profile?.name || "Prototype User",
      userPhone: req.profile?.phone || "+919999999999",
      city,
      cityNormalized: normalizeCity(city),
      pickupAddress: req.body.pickupAddress.trim(),
      location,
      scrapCategory: req.body.scrapCategory,
      category: req.body.scrapCategory,
      quantity: req.body.quantity.trim(),
      description: req.body.description.trim(),
      images: Array.isArray(req.body.images) ? req.body.images.slice(0, 5) : [],
      imageUrl: req.body.imageUrl,
      imagePublicId: req.body.imagePublicId,
      imageUrls: Array.isArray(req.body.imageUrls) ? req.body.imageUrls.slice(0, 5) : [req.body.imageUrl],
      address,
      pickupLocation: location,
      pickupLat: location?.lat ?? null,
      pickupLng: location?.lng ?? null,
      aiDetectedCategory: req.body.aiDetectedCategory || null,
      aiConfidence: typeof req.body.aiConfidence === "number" ? req.body.aiConfidence : null,
      aiNotes: req.body.aiNotes || null,
      status: "open",
      collectorId: null,
      collectorName: null,
      collectorPhone: null,
      acceptedBy: null,
      expectedPrice: typeof req.body.expectedPrice === "number" ? req.body.expectedPrice : null,
      finalPrice: null,
      trackingEnabled: false,
      trackingStartedAt: null,
      trackingStoppedAt: null,
      acceptedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(data);
    res.status(201).json({ requestId: ref.id });
  } catch (error) {
    next(error);
  }
});

router.post("/:requestId/accept", authMiddleware, requireCollector, async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const collectorId = req.body.collectorId || req.collector?.uid || req.user?.uid || "prototype_collector";
    const collectorName = req.body.collectorName || req.collector?.name || "Prototype Collector";
    
    const result = await db.runTransaction(async (transaction) => {
      const ref = requestDoc(requestId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        const error = new Error("Request not found.");
        error.status = 404;
        throw error;
      }

      const pickup = snapshot.data();
      if (pickup.status !== "open") {
        const error = new Error("Request is no longer open.");
        error.status = 409;
        throw error;
      }

      transaction.update(ref, {
        status: "accepted",
        collectorId: collectorId,
        acceptedBy: collectorId,
        collectorName: collectorName,
        collectorPhone: req.collector?.phone || null,
        trackingEnabled: false,
        trackingStartedAt: null,
        trackingStoppedAt: null,
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { requestId, status: "accepted" };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:requestId/complete", authMiddleware, requireCollector, async (req, res, next) => {
  try {
    const ref = requestDoc(req.params.requestId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: "Request not found." });

    const pickup = snapshot.data();
    if (pickup.status !== "accepted") {
      return res.status(409).json({ error: "Only accepted requests can be completed." });
    }

    await ref.update({
      status: "completed",
      finalPrice: typeof req.body.finalPrice === "number" ? req.body.finalPrice : pickup.finalPrice ?? null,
      trackingEnabled: false,
      trackingStoppedAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.json({ requestId: req.params.requestId, status: "completed" });
  } catch (error) {
    next(error);
  }
});

router.post("/:requestId/cancel", authMiddleware, async (req, res, next) => {
  try {
    const ref = requestDoc(req.params.requestId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: "Request not found." });

    const pickup = snapshot.data();
    const [userProfile, collectorProfile] = await Promise.all([
      loadUserProfile(req.user.uid),
      loadCollectorProfile(req.user.uid),
    ]);
    const isOwnerUser = userProfile?.role === "user" && pickup.userId === req.user.uid && pickup.status === "open";
    const isAssignedCollector = Boolean(collectorProfile) && pickup.collectorId === req.user.uid && pickup.status === "accepted";

    if (!isOwnerUser && !isAssignedCollector) {
      return res.status(403).json({ error: "You cannot cancel this request." });
    }

    await ref.update({
      status: "cancelled",
      trackingEnabled: false,
      trackingStoppedAt: serverTimestamp(),
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.json({ requestId: req.params.requestId, status: "cancelled" });
  } catch (error) {
    next(error);
  }
});
router.post("/:requestId/tracking", authMiddleware, requireCollector, async (req, res, next) => {
  try {
    const { enabled } = req.body;
    const ref = requestDoc(req.params.requestId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return res.status(404).json({ error: "Request not found." });

    const pickup = snapshot.data();
    if (pickup.status !== "accepted") {
      return res.status(400).json({ error: "Tracking can only be changed for accepted requests." });
    }

    await ref.update({
      trackingEnabled: enabled === true,
      trackingStartedAt: enabled === true ? serverTimestamp() : pickup.trackingStartedAt || null,
      trackingStoppedAt: enabled === false ? serverTimestamp() : pickup.trackingStoppedAt || null,
      updatedAt: serverTimestamp(),
    });

    res.json({ requestId: req.params.requestId, trackingEnabled: enabled === true });
  } catch (error) {
    next(error);
  }
});

router.get("/:requestId", authMiddleware, async (req, res, next) => {
  try {
    const snapshot = await requestDoc(req.params.requestId).get();
    if (!snapshot.exists) return res.status(404).json({ error: "Request not found." });
    res.json(serializeFirestore(snapshot.data()));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
