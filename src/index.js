/**
 * Punto de Oro — servidor del marcador en vivo.
 *
 * Un Durable Object por torneo: guarda el estado y lo reparte al instante a
 * todos los que tengan abierto el enlace público. Solo quien lleva la clave
 * secreta puede escribir; el resto solo mira.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export class Tournament {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(req) {
    const url = new URL(req.url);

    // Suscripción en vivo
    if (url.pathname.endsWith("/ws")) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Se esperaba un websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      // Hibernación: el DO puede dormirse sin cerrar las conexiones.
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (req.method === "GET") {
      const data = await this.ctx.storage.get("data");
      if (!data) return json({ error: "no existe" }, 404);
      return json({ data, updated: (await this.ctx.storage.get("updated")) || 0 });
    }

    /* Anotar un marcador suelto. Basta con conocer la clave, porque el
       torneo se comparte para que cualquiera del grupo pueda anotar su
       cancha. Solo toca ese partido: así dos personas anotando a la vez
       no se pisan, cosa que sí pasaría mandando el torneo entero. */
    if (url.pathname.endsWith("/marcador") && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch (e) { return json({ error: "json inválido" }, 400); }

      const data = await this.ctx.storage.get("data");
      if (!data) return json({ error: "no existe" }, 404);
      if (data.finished) return json({ error: "el torneo ya está cerrado" }, 409);

      const ronda = Array.isArray(data.rounds) ? data.rounds[b.r] : null;
      if (!ronda) return json({ error: "esa ronda no existe" }, 400);
      const partido = ronda.matches && ronda.matches[b.m];
      if (!partido) return json({ error: "esa cancha no existe" }, 400);

      const tope = Number(data.roundPoints) || 99;
      const limpia = (v) => {
        if (v === null || v === undefined || v === "") return null;
        const x = parseInt(v, 10);
        return isNaN(x) ? null : Math.max(0, Math.min(tope, x));
      };
      partido.sa = limpia(b.sa);
      partido.sb = limpia(b.sb);

      const updated = Date.now();
      await this.ctx.storage.put("data", data);
      await this.ctx.storage.put("updated", updated);
      this.broadcast(JSON.stringify({ type: "state", data, updated }));
      return json({ ok: true });
    }

    if (req.method === "PUT") {
      let body;
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: "json inválido" }, 400);
      }
      if (!body || typeof body.key !== "string" || body.key.length < 8) {
        return json({ error: "falta la clave" }, 400);
      }

      const meta = await this.ctx.storage.get("meta");
      if (meta && meta.key !== body.key) {
        return json({ error: "solo el organizador puede modificar este torneo" }, 403);
      }
      if (!meta) await this.ctx.storage.put("meta", { key: body.key, created: Date.now() });

      const updated = Date.now();
      await this.ctx.storage.put("data", body.data);
      await this.ctx.storage.put("updated", updated);

      this.broadcast(JSON.stringify({ type: "state", data: body.data, updated }));
      return json({ ok: true, updated });
    }

    if (req.method === "DELETE") {
      const key = url.searchParams.get("k") || "";
      const meta = await this.ctx.storage.get("meta");
      if (!meta || meta.key !== key) return json({ error: "no autorizado" }, 403);
      await this.ctx.storage.deleteAll();
      this.broadcast(JSON.stringify({ type: "deleted" }));
      return json({ ok: true });
    }

    return json({ error: "método no soportado" }, 405);
  }

  broadcast(msg) {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch (e) { /* conexión muerta, se limpia sola */ }
    }
  }

  // Al conectarse, el cliente pide "hola" y le mandamos el estado actual.
  async webSocketMessage(ws, msg) {
    if (msg === "hola") {
      const data = await this.ctx.storage.get("data");
      const updated = (await this.ctx.storage.get("updated")) || 0;
      if (data) ws.send(JSON.stringify({ type: "state", data, updated }));
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch (e) {}
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // La app pregunta por aquí si este alojamiento tiene marcador en vivo.
    if (url.pathname === "/api/ping.json") return json({ ok: true });

    const m = url.pathname.match(/^\/api\/t\/([A-Za-z0-9_-]{3,64})(\/(ws|marcador))?$/);

    if (m) {
      const stub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(m[1]));
      return stub.fetch(req);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "ruta desconocida" }, 404);

    // Todo lo demás (incluido /t/<slug>) sirve la app.
    return env.ASSETS.fetch(req);
  },
};
