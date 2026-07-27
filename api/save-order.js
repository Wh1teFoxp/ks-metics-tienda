// Guarda un pedido en la base "Pedidos" de Notion.
// Se llama justo antes de abrir WhatsApp o de copiar el texto, nunca desde el navegador con el token expuesto.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const token = process.env.NOTION_TOKEN;
  const pedidosDatabaseId = process.env.NOTION_PEDIDOS_DATABASE_ID;

  if (!token || !pedidosDatabaseId) {
    return res.status(500).json({ error: "Faltan variables de entorno de Pedidos en Vercel." });
  }

  try {
    const { customerName, items, total, channel } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Pedido vacío" });
    }

    const now = new Date();
    const productosTexto = items
      .map((i) => `${i.name}${i.presentation ? ` (${i.presentation})` : ""} x${i.qty} — $${(i.price * i.qty).toFixed(2)}`)
      .join("\n");

    const notionRes = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: pedidosDatabaseId },
        properties: {
          Cliente: { title: [{ text: { content: customerName || "Cliente sin nombre" } }] },
          Fecha: { date: { start: now.toISOString() } },
          Productos: { rich_text: [{ text: { content: productosTexto } }] },
          "Total (Bs/$ BCV)": { number: Number(total) || 0 },
          Estado: { select: { name: "Nuevo" } },
          Notas: { rich_text: [{ text: { content: channel === "whatsapp" ? "Enviado por WhatsApp" : "Copiado por el cliente" } }] },
        },
      }),
    });

    if (!notionRes.ok) {
      const errText = await notionRes.text();
      return res.status(502).json({ error: "Notion respondió con error", detail: errText });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "No se pudo guardar el pedido", detail: String(err) });
  }
}
