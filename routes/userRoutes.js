const express = require("express");
const { db } = require("../firebaseAdmin");
const { authMiddleware, requireUser } = require("../middleware/authMiddleware");
const { serializeFirestore } = require("../utils/validators");

const router = express.Router();

router.get("/my-requests", authMiddleware, requireUser, async (req, res, next) => {
  try {
    const uid = req.profile?.uid || req.user?.uid || "prototype_user";
    const snapshot = await db
      .collection("requests")
      .where("userId", "==", uid)
      .orderBy("createdAt", "desc")
      .get();

    res.json(snapshot.docs.map((doc) => serializeFirestore(doc.data())));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
