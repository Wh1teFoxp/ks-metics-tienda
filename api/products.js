// Esta función corre en el servidor de Vercel, nunca en el navegador del cliente.
// Por eso el token de Notion (guardado como variable de entorno) queda seguro.

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    return res.status(500).json({
      error: "Faltan las variables de entorno NOTION_TOKEN o NOTION_DATABASE_ID en Vercel.",
    });
  }

  try {
    const notionRes = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!notionRes.ok) {
      const errText = await notionRes.text();
      return res.status(502).json({ error: "Notion respondió con error", detail: errText });
    }

    const data = await notionRes.json();

    const products = data.results
      .map((page) => {
        const p = page.properties;
        const fotoArr = p["Foto"]?.files || [];
        const foto = fotoArr[0];
        const imageUrl = foto
          ? (foto.type === "external" ? foto.external?.url : foto.file?.url) || null
          : null;

        const joinRichText = (prop) => (prop?.rich_text || []).map((t) => t.plain_text).join("");

        return {
          id: page.id,
          name: p["Producto"]?.title?.[0]?.plain_text || "Sin nombre",
          brand: joinRichText(p["Marca"]),
          presentation: joinRichText(p["Presentación"]),
          price: p["Precio"]?.number ?? 0,
          cat: (p["Categoría"]?.select?.name || "otros").toLowerCase(),
          desc: joinRichText(p["Descripción"]),
          available: p["Disponible"]?.checkbox ?? false,
          featured: p["Destacado"]?.checkbox ?? false,
          image: imageUrl,
        };
      })
      .filter((p) => p.available);

    // Cachea poco tiempo: las fotos subidas directo a Notion vencen su link ~1 hora
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate");
    return res.status(200).json(products);
  } catch (err) {
    return res.status(500).json({ error: "No se pudo conectar con Notion", detail: String(err) });
  }
}
