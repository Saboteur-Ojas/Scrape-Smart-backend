const express = require("express");
const { admin, db } = require("../firebaseAdmin");
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

const GEMINI_MODEL = "gemini-2.5-flash";
const CATEGORIES = new Set(["newspaper", "cardboard", "plastic", "metal", "e_waste", "mixed", "other"]);
const SCRAP_DETECTION_PROMPT = `
You are the scrap-classification assistant for ScrapSmart, a pickup app in India.
Analyze the uploaded image as a scrap pickup photo, not as a general captioning task.

Return exactly one JSON object. Do not include markdown, prose, or extra keys.

Allowed detectedCategory values:
- newspaper: loose newspapers, magazines, notebooks, office paper, books, paper bundles
- cardboard: corrugated boxes, cartons, packaging boxes, brown board sheets
- plastic: bottles, containers, wrappers, buckets, plastic packaging, mixed visible plastics
- metal: cans, utensils, pipes, wires with mostly metal, metal sheets, metal parts
- e_waste: phones, chargers, cables, batteries, circuit boards, appliances, computer parts
- mixed: multiple recyclable categories are clearly visible and no single category dominates
- other: unclear image, non-scrap object, organic waste, cloth, glass-only items, or not enough visual evidence

Return JSON with detectedCategory, confidence, notes, and suggestedDescription.
`.trim();

function normalizeCategory(value) {
  return typeof value === "string" && CATEGORIES.has(value) ? value : "other";
}

function normalizeConfidence(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, normalized));
}

function parseGeminiJson(text) {
  const fallback = {
    detectedCategory: "other",
    confidence: 0,
    notes: "Could not confidently detect scrap type.",
    suggestedDescription: "Scrap material image uploaded by user",
  };

  try {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned);
    return {
      detectedCategory: normalizeCategory(parsed.detectedCategory),
      confidence: normalizeConfidence(parsed.confidence),
      notes: typeof parsed.notes === "string" && parsed.notes.trim()
        ? parsed.notes.trim().slice(0, 220)
        : fallback.notes,
      suggestedDescription: typeof parsed.suggestedDescription === "string" && parsed.suggestedDescription.trim()
        ? parsed.suggestedDescription.trim().slice(0, 160)
        : fallback.suggestedDescription,
    };
  } catch {
    return fallback;
  }
}

async function imageUrlToBase64(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    const error = new Error("Could not read image URL.");
    error.status = 400;
    throw error;
  }

  const mimeType = response.headers.get("content-type") || "";
  if (!mimeType.startsWith("image/")) {
    const error = new Error("Image URL must point to an image.");
    error.status = 400;
    throw error;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return { mimeType, data: bytes.toString("base64") };
}

router.post("/detect", authMiddleware, async (req, res, next) => {
  try {
    const { imageUrl } = req.body || {};
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
      return res.status(400).json({ error: "imageUrl must be an HTTPS image URL." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the backend." });
    }

    const image = await imageUrlToBase64(imageUrl);
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SCRAP_DETECTION_PROMPT },
                { inlineData: image },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.15,
            topP: 0.8,
            maxOutputTokens: 350,
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const body = await geminiResponse.text().catch(() => "");
      console.warn("Gemini scrap detection failed", {
        status: geminiResponse.status,
        statusText: geminiResponse.statusText,
        body: body.slice(0, 500),
      });
      return res.status(502).json({ error: "AI detection failed. Please try again." });
    }

    const body = await geminiResponse.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    const detection = parseGeminiJson(typeof text === "string" ? text : "");
    const ref = db.collection("aiDetections").doc();

    await ref.set({
      detectionId: ref.id,
      userId: req.user.uid,
      imageUrl,
      ...detection,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ detectionId: ref.id, ...detection });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
