export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "50mb",
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 50 * 1024 * 1024) {
        reject(new Error("File too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function detectMedia(body, headerType) {
  // JPEG
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return { isVideo: false, type: "image/jpeg", ext: "jpg" };
  }

  // PNG
  if (
    body.length >= 8 &&
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47
  ) {
    return { isVideo: false, type: "image/png", ext: "png" };
  }

  // MP4 / MOV / 3GP: ISO Base Media File Format has "ftyp" at byte 4.
  if (
    body.length >= 12 &&
    body[4] === 0x66 &&
    body[5] === 0x74 &&
    body[6] === 0x79 &&
    body[7] === 0x70
  ) {
    const brand = body.toString("ascii", 8, 12).toLowerCase();
    const is3gp = brand.startsWith("3gp");
    return { isVideo: true, type: is3gp ? "video/3gpp" : "video/mp4", ext: is3gp ? "3gp" : "mp4" };
  }

  // Fallback to the request Content-Type.
  const type = headerType || "application/octet-stream";
  const isVideo = type.startsWith("video/");
  return {
    isVideo,
    type,
    ext: isVideo ? (type.includes("3gpp") ? "3gp" : "mp4") : (type.includes("png") ? "png" : "jpg"),
  };
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
      return res.status(400).json({ ok: false, error: "Empty file" });
    }

    const media = detectMedia(body, req.headers["content-type"]);

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append(
      media.isVideo ? "video" : "photo",
      new Blob([body], { type: media.type }),
      `camera-${Date.now()}.${media.ext}`
    );

    const method = media.isVideo ? "sendVideo" : "sendPhoto";
    const tg = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
      { method: "POST", body: form }
    );

    const result = await tg.json();

    if (!tg.ok || !result.ok) {
      console.error("Telegram error:", result);
      return res.status(502).json({ ok: false, error: "Telegram upload failed" });
    }

    return res.status(200).json({ ok: true, type: media.isVideo ? "video" : "photo" });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
}
