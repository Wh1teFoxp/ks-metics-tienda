// Esta función corre en el servidor de Vercel, nunca en el navegador del cliente.
// Por eso el token de Notion (guardado como variable de entorno) queda seguro.

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  const configDatabaseId = process.env.NOTION_CONFIG_DATABASE_ID;

  if (!token || !databaseId || !configDatabaseId) {
    return res.status(500).json({
      error: "Faltan variables de entorno (NOTION_TOKEN, NOTION_DATABASE_ID o NOTION_CONFIG_DATABASE_ID) en Vercel.",
    });
  }

  try {
    // 1. Trae la configuración de precios (tasas + margen general)
    const configRes = await fetch(
      `https://api.notion.com/v1/databases/${configDatabaseId}/query`,
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
    const configData = await configRes.json();
    const configRow = configData.results?.[0]?.properties;
    const brecha = configRow?.["Brecha BCV/USDT %"]?.number ?? 0;
    const margenGeneral = configRow?.["Margen General %"]?.number ?? 0;

    // 2. Trae los productos
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

        const costoUSD = p["Costo USD"]?.number ?? 0;
        const margenIndividual = p["Margen Individual %"]?.number;
        const precioManual = p["Precio Manual"]?.checkbox ?? false;
        const precioFijo = p["Precio"]?.number ?? 0;

        // Precio calculado en vivo: costo ajustado por la brecha BCV/USDT + margen
        const margenAplicado = margenIndividual != null ? margenIndividual : margenGeneral;
        const costoAjustado = costoUSD * (1 + brecha / 100);
        const precioCalculado = Math.round(costoAjustado * (1 + margenAplicado / 100) * 100) / 100;

        const precioFinal = precioManual || !costoUSD ? precioFijo : precioCalculado;

        return {
          id: page.id,
          name: p["Producto"]?.title?.[0]?.plain_text || "Sin nombre",
          brand: joinRichText(p["Marca"]),
          presentation: joinRichText(p["Presentación"]),
          price: precioFinal,
          cat: (p["Categoría"]?.select?.name || "otros").toLowerCase(),
          desc: joinRichText(p["Descripción"]),
          available: p["Disponible"]?.checkbox ?? false,
          featured: p["Destacado"]?.checkbox ?? false,
          onSale: p["Oferta"]?.checkbox ?? false,
          lastUnits: p["Últimas Unidades"]?.checkbox ?? false,
          image: imageUrl,
        };
      })
      .filter((p) => p.available);

    // Cachea poco tiempo: precios y fotos se recalculan/refrescan seguido
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate");
    return res.status(200).json(products);
  } catch (err) {
    return res.status(500).json({ error: "No se pudo conectar con Notion", detail: String(err) });
  }
}
