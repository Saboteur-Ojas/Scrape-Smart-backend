const express = require("express");
const { db } = require("../firebaseAdmin");
const { authMiddleware, requireUser } = require("../middleware/authMiddleware");
const { serializeFirestore } = require("../utils/validators");

const router = express.Router();

router.get("/my-requests", authMiddleware, requireUser, async (req, res, next) => {
  try {
    const snapshot = await db
      .collection("requests")
      .where("userId", "==", req.user.uid)
      .orderBy("createdAt", "desc")
      .get();

    res.json(snapshot.docs.map((doc) => serializeFirestore(doc.data())));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
