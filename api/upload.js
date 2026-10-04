export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "12mb",
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 12 * 1024 * 1024) {
        reject(new Error("Photo too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const uploadKey = req.headers["x-upload-key"];
  if (!process.env.UPLOAD_KEY || uploadKey !== process.env.UPLOAD_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const chatId = req.headers["x-chat-id"] || process.env.TELEGRAM_CHAT_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) {
    return res.status(500).json({ ok: false, error: "Telegram settings are missing" });
  }

  try {
    const body = await readRawBody(req);
    if (!body.length) {
      return res.status(400).json({ ok: false, error: "Empty photo" });
    }

    const contentType = req.headers["content-type"] || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append(
      "photo",
      new Blob([body], { type: contentType }),
      `camera-${Date.now()}.${ext}`
    );

    const tg = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      { method: "POST", body: form }
    );

    const result = await tg.json();

    if (!tg.ok || !result.ok) {
      console.error("Telegram error:", result);
      return res.status(502).json({ ok: false, error: "Telegram upload failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
}
