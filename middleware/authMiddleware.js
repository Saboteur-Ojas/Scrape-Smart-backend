const { admin, db, tokenStorage } = require("../firebaseAdmin");

async function authMiddleware(req, res, next) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : null;

  tokenStorage.run(token, async () => {
    if (!match) {
      // Lenient for prototype: If no token, proceed with a dummy user or just let it pass
      req.user = null;
      return next();
    }

    try {
      const decoded = await admin.auth().verifyIdToken(match[1]);
      req.user = decoded;
      next();
    } catch (error) {
      // Lenient for prototype: ignore invalid/expired token and proceed
      console.warn("Token expired or invalid, proceeding in lenient mode.");
      req.user = null;
      next();
    }
  });
}

async function loadUserProfile(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function loadCollectorProfile(uid) {
  let snapshot = await db.collection("collectors").doc(uid).get();
  if (snapshot.exists) {
    return snapshot.data();
  }
  // Double fallback: check the users collection which has collector profile details too
  snapshot = await db.collection("users").doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function requireUser(req, res, next) {
  try {
    if (!req.user) {
      req.profile = { role: "user", uid: "prototype_user" };
      return next();
    }
    const profile = await loadUserProfile(req.user.uid);
    if (!profile || profile.role !== "user") {
      req.profile = { role: "user", uid: req.user.uid };
    } else {
      req.profile = profile;
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function requireCollector(req, res, next) {
  try {
    const fallbackUid = req.query.collectorId || req.body.collectorId;
    const uid = req.user ? req.user.uid : fallbackUid;
    
    if (!uid) {
      req.collector = {
        role: "collector",
        uid: "prototype_collector",
        name: "Prototype Collector",
        phone: "+919999999999"
      };
      return next();
    }
    
    const collector = await loadCollectorProfile(uid);
    if (!collector) {
      req.collector = {
        role: "collector",
        uid,
        name: req.user?.name || req.user?.email?.split("@")[0] || "Active Collector",
        phone: req.user?.phone || "+919999999999"
      };
    } else {
      req.collector = {
        ...collector,
        name: collector.name || req.user?.name || req.user?.email?.split("@")[0] || "Active Collector",
        phone: collector.phone || req.user?.phone || "+919999999999"
      };
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authMiddleware,
  loadCollectorProfile,
  loadUserProfile,
  requireUser,
  requireCollector,
};
