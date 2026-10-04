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

function extensionForType(type) {
  const map = {
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/vnd.android.package-archive": "apk",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/json": "json",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };
  return map[type] || "bin";
}

function detectMedia(body, headerType) {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return { kind: "photo", type: "image/jpeg", ext: "jpg" };
  }

  if (
    body.length >= 8 &&
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47
  ) {
    return { kind: "photo", type: "image/png", ext: "png" };
  }

  if (
    body.length >= 12 &&
    body[4] === 0x66 &&
    body[5] === 0x74 &&
    body[6] === 0x79 &&
    body[7] === 0x70
  ) {
    const brand = body.toString("ascii", 8, 12).toLowerCase();
    const is3gp = brand.startsWith("3gp");
    return {
      kind: "video",
      type: is3gp ? "video/3gpp" : "video/mp4",
      ext: is3gp ? "3gp" : "mp4",
    };
  }

  const type = (headerType || "application/octet-stream").split(";")[0].trim().toLowerCase();

  if (type.startsWith("image/")) {
    return { kind: "photo", type, ext: type.includes("png") ? "png" : "jpg" };
  }

  if (type.startsWith("video/")) {
    return { kind: "video", type, ext: type.includes("3gpp") ? "3gp" : "mp4" };
  }

  return { kind: "document", type, ext: extensionForType(type) };
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

    const field = media.kind === "video" ? "video" : media.kind === "photo" ? "photo" : "document";
    form.append(
      field,
      new Blob([body], { type: media.type }),
      `download-${Date.now()}.${media.ext}`
    );

    const method =
      media.kind === "video"
        ? "sendVideo"
        : media.kind === "photo"
          ? "sendPhoto"
          : "sendDocument";

    const tg = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
      { method: "POST", body: form }
    );

    const result = await tg.json();

    if (!tg.ok || !result.ok) {
      console.error("Telegram error:", result);
      return res.status(502).json({ ok: false, error: "Telegram upload failed" });
    }

    return res.status(200).json({ ok: true, type: media.kind });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
}
